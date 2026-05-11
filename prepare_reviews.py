#!/usr/bin/env python3
"""
prepare_reviews.py — Prepare paper text for the review sub-agent.

1. Scans markdown_full/ for paper markdown files
2. Checks review_md/ to skip already-reviewed papers  
3. Extracts paper text (truncated to fit LLM context)
4. Writes review_batch.json with {paper_id: {text, title}} for the cron agent
"""

import json
import re
import sys
from pathlib import Path

ARXIV_ID_RE = re.compile(r"^\d{4}\.\d{4,}$")

BASE_DIR = Path(__file__).resolve().parent
MD_DIR = BASE_DIR / "markdown_full"
REVIEW_DIR = BASE_DIR / "viewer" / "review_md"
BATCH_FILE = BASE_DIR / "review_batch.json"
REVIEW_DIR.mkdir(exist_ok=True)

MAX_PAPER_CHARS = 35_000  # truncate paper to ~8K tokens

def main():
    md_files = sorted(MD_DIR.glob("*.md"))
    if not md_files:
        print("[ERROR] No markdown files found in markdown_full/")
        sys.exit(1)

    batch = []
    skipped = 0
    for f in md_files:
        aid = f.stem  # e.g., "2304.03442"
        if not ARXIV_ID_RE.match(aid):
            continue  # skip index.html, etc.
        review_path = REVIEW_DIR / f"{aid}.md"
        if review_path.exists() and review_path.stat().st_size > 500:
            skipped += 1
            continue

        text = f.read_text(encoding="utf-8", errors="replace")
        if len(text) > MAX_PAPER_CHARS:
            text = text[:MAX_PAPER_CHARS] + "\n\n[论文内容过长，已截断至前 35,000 字符]"

        batch.append({"arxiv_id": aid, "text": text})

    if not batch:
        print(f"[INFO] All {len(md_files)} papers already reviewed. Nothing to do.")
        sys.exit(0)

    with open(BATCH_FILE, "w", encoding="utf-8") as f:
        json.dump(batch, f, ensure_ascii=False, indent=2)

    print(f"[OK] Batch prepared: {len(batch)} pending, {skipped} already done")
    print(f"[INFO] Batch file: {BATCH_FILE} ({BATCH_FILE.stat().st_size} bytes)")

if __name__ == "__main__":
    main()
