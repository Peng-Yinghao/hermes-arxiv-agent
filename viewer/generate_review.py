#!/usr/bin/env python3
"""Generate a Chinese academic review for a single paper via MiMo API."""
import json
import sys
import time
import urllib.request
from pathlib import Path

VIEWER_DIR = Path(__file__).resolve().parent
PROJ_DIR = VIEWER_DIR.parent
REVIEW_PROMPT = Path("/tmp/review_papers/review_prompt.md")

API_URL = "https://token-plan-cn.xiaomimimo.com/v1/chat/completions"
API_KEY = "tp-cp69u1drlbl7xp1o10rlwaraqwmxqt95vyb7l9sdtwiz115k"
MODEL = "mimo-v2.5-pro"


def load_prompt() -> str:
    if REVIEW_PROMPT.exists():
        return REVIEW_PROMPT.read_text(encoding="utf-8")
    # Fallback: load from skill
    import subprocess
    result = subprocess.run(
        ["hermes", "skill-view", "hermes-arxiv-agent-deploy",
         "--file", "references/review_prompt.md"],
        capture_output=True, text=True, timeout=10,
        env={"PATH": "/opt/data/home/.local/bin:/usr/bin:/bin", "HOME": "/opt/data/home"}
    )
    if result.returncode == 0:
        return result.stdout
    raise FileNotFoundError("review_prompt.md not found")


def load_paper(arxiv_id: str) -> str:
    """Load paper from markdown_full/ or review_papers/ tmp."""
    # Try full markdown first
    md_path = PROJ_DIR / "markdown_full" / f"{arxiv_id}.md"
    if md_path.exists():
        text = md_path.read_text(encoding="utf-8")
        if len(text) > 500:
            return text[:80000]  # Cap at 80KB for API

    # Try tmp file
    tmp_path = Path(f"/tmp/review_papers/{arxiv_id.replace('.', '_')}.txt")
    if tmp_path.exists():
        text = tmp_path.read_text(encoding="utf-8")
        if len(text) > 500:
            return text[:80000]

    # Try downloading from ar5iv
    import subprocess
    result = subprocess.run(
        ["curl", "-sL", "--max-time", "30",
         f"https://ar5iv.labs.arxiv.org/html/{arxiv_id}"],
        capture_output=True, text=True, timeout=35
    )
    if result.returncode == 0 and len(result.stdout) > 1000:
        # Extract text from HTML
        from html.parser import HTMLParser

        class TextExtractor(HTMLParser):
            def __init__(self):
                super().__init__()
                self.text = []
                self.skip = False

            def handle_starttag(self, tag, attrs):
                if tag in ("script", "style", "nav", "footer", "header"):
                    self.skip = True

            def handle_endtag(self, tag):
                if tag in ("script", "style", "nav", "footer", "header"):
                    self.skip = False

            def handle_data(self, data):
                if not self.skip:
                    text = data.strip()
                    if text:
                        self.text.append(text)

        extractor = TextExtractor()
        extractor.feed(result.stdout)
        return "\n\n".join(extractor.text)[:80000]

    raise FileNotFoundError(f"Cannot load paper {arxiv_id}")


def main():
    arxiv_id = None
    do_publish = False
    args = sys.argv[1:]
    for a in args:
        if a == "--publish":
            do_publish = True
        elif not a.startswith("--"):
            arxiv_id = a
    if not arxiv_id:
        print("ERROR: arxiv_id required", file=sys.stderr)
        print("Usage: generate_review.py [--publish] <arxiv_id>", file=sys.stderr)
        sys.exit(1)

    output_path = VIEWER_DIR / "review_md" / f"{arxiv_id}.md"
    output_path.parent.mkdir(parents=True, exist_ok=True)

    status_path = VIEWER_DIR / "review_md" / f"{arxiv_id}.status.json"

    # Write "generating" status
    status_path.write_text(json.dumps({
        "arxiv_id": arxiv_id,
        "status": "generating",
        "started_at": time.time(),
    }))

    try:
        print(f"[REVIEW] Loading paper {arxiv_id}...")
        paper_text = load_paper(arxiv_id)
        print(f"[REVIEW] Paper loaded: {len(paper_text)} chars")

        prompt = load_prompt()
        print(f"[REVIEW] Prompt loaded: {len(prompt)} chars")

        full_content = prompt + "\n\n以下是需要你精读的论文全文：\n\n" + paper_text

        payload = json.dumps({
            "model": MODEL,
            "messages": [{"role": "user", "content": full_content}],
            "max_tokens": 8192,
            "temperature": 0.7,
        }).encode("utf-8")

        req = urllib.request.Request(
            API_URL,
            data=payload,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {API_KEY}",
            },
            method="POST",
        )

        print(f"[REVIEW] Calling API...")
        start = time.time()
        resp = urllib.request.urlopen(req, timeout=300)
        result = json.loads(resp.read().decode("utf-8"))
        elapsed = time.time() - start

        content = result["choices"][0]["message"]["content"]
        tokens = result.get("usage", {})

        output_path.write_text(content, encoding="utf-8")
        print(f"[REVIEW] Saved {len(content)} chars to {output_path} ({elapsed:.1f}s)")

        # Update status
        status_path.write_text(json.dumps({
            "arxiv_id": arxiv_id,
            "status": "completed",
            "chars": len(content),
            "elapsed": round(elapsed, 1),
            "tokens": tokens,
            "saved_at": time.time(),
        }))

        # Update papers_data.json
        data_path = VIEWER_DIR / "papers_data.json"
        if data_path.exists():
            data = json.loads(data_path.read_text(encoding="utf-8"))
            for p in data["papers"]:
                if p["arxiv_id"] == arxiv_id:
                    p["has_review"] = True
                    break
            data_path.write_text(json.dumps(data, ensure_ascii=False, indent=2))

        print(f"[REVIEW] Done ✓")

        # Publish to GitHub Pages if requested
        if do_publish:
            print("[PUBLISH] Rebuilding data + pushing to GitHub...")
            pub_ok = True
            # 1) Rebuild papers_data.json
            result = subprocess.run(
                [sys.executable, str(VIEWER_DIR / "build_data.py")],
                capture_output=True, text=True, timeout=30,
                cwd=str(VIEWER_DIR),
            )
            if result.returncode != 0:
                print(f"[PUBLISH] build_data failed: {result.stderr}", file=sys.stderr)
                pub_ok = False

            # 2) Push to GitHub
            if pub_ok:
                result = subprocess.run(
                    ["bash", str(PROJ_DIR / "scripts" / "publish_viewer.sh")],
                    capture_output=True, text=True, timeout=120,
                    cwd=str(PROJ_DIR),
                )
                if result.returncode == 0:
                    print(f"[PUBLISH] ✓ Pushed to GitHub Pages")
                    # Update status
                    cur = json.loads(status_path.read_text())
                    cur["published"] = True
                    status_path.write_text(json.dumps(cur, ensure_ascii=False, indent=2))
                else:
                    print(f"[PUBLISH] publish_viewer failed: {result.stderr}", file=sys.stderr)
            else:
                print("[PUBLISH] Skipped — build_data failed", file=sys.stderr)

    except Exception as e:
        print(f"[REVIEW] ERROR: {e}", file=sys.stderr)
        status_path.write_text(json.dumps({
            "arxiv_id": arxiv_id,
            "status": "error",
            "error": str(e),
            "failed_at": time.time(),
        }))
        sys.exit(1)


if __name__ == "__main__":
    main()
