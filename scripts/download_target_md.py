#!/usr/bin/env python3
"""Download markdown for target conference papers with long delays."""
import subprocess
import shutil
import time
from pathlib import Path

ARXIV2MD = shutil.which("arxiv2md") or str(Path.home() / ".local/bin/arxiv2md")
OUTPUT_DIR = Path("/opt/data/home/hermes-arxiv-agent/markdown_full")
OUTPUT_DIR.mkdir(exist_ok=True)

# Target conference papers
TARGET_IDS = [
    # CHI
    "2603.29890", "2603.27563",
    # WWW
    "2603.24973", "2603.19649", "2503.23804",
    # AAAI
    "2603.16264", "2509.09734",
    # ACL
    "2506.21605", "2506.03532", "2502.13172", "2502.11127",
    # EMNLP
    "2506.19209", "2506.15741", "2506.06326", "2505.15068", "2503.11733", "2503.02682",
    # ICML
    "2506.05109", "2505.04345",
    # ICLR
    "2502.05589", "2501.01702",
]

DELAY = 8  # seconds between requests

success = 0
fail = 0
for i, aid in enumerate(TARGET_IDS):
    output_path = OUTPUT_DIR / f"{aid}.md"
    if output_path.exists() and output_path.stat().st_size > 100:
        print(f"[{i+1}/{len(TARGET_IDS)}] SKIP {aid} (exists, {output_path.stat().st_size:,} bytes)")
        success += 1
        continue
    
    print(f"[{i+1}/{len(TARGET_IDS)}] Downloading {aid}...", flush=True)
    try:
        result = subprocess.run(
            [ARXIV2MD, aid, "--remove-refs", "--frontmatter", "-o", str(output_path)],
            capture_output=True, text=True, timeout=90,
        )
        if result.returncode != 0:
            stderr = result.stderr.strip()
            if "not found" in stderr.lower() or "no html" in stderr.lower() or "404" in stderr:
                print(f"  SKIP: no HTML version")
            else:
                print(f"  ERROR: {stderr[:120]}")
            output_path.write_text(f"# {aid}\n\nHTML version not available.\n")
            fail += 1
        else:
            size = output_path.stat().st_size
            print(f"  OK: {size:,} bytes")
            success += 1
    except subprocess.TimeoutExpired:
        print(f"  TIMEOUT")
        fail += 1
    except Exception as e:
        print(f"  ERROR: {e}")
        fail += 1
    
    if i < len(TARGET_IDS) - 1:
        print(f"  (waiting {DELAY}s...)", flush=True)
        time.sleep(DELAY)

print(f"\nDone: {success} success, {fail} failed")
