import xml.etree.ElementTree as ET
import urllib.request
import json
import re
import os
import time

FEEDS = {
    "cs.AI": "https://rss.arxiv.org/rss/cs.AI",
    "cs.CL": "https://rss.arxiv.org/rss/cs.CL",
    "cs.LG": "https://rss.arxiv.org/rss/cs.LG",
    "cs.MA": "https://rss.arxiv.org/rss/cs.MA",
    "cs.IR": "https://rss.arxiv.org/rss/cs.IR",
    "cs.HC": "https://rss.arxiv.org/rss/cs.HC",
}

EXCLUDE_TERMS = ["quantization", "GPU", "hardware", "FPGA", "binarization", "quantiz", "quantis"]

def matches_keywords(title, description):
    text = (title + " " + description).lower()
    has_agent = "agent" in text
    has_memory = "memory" in text
    if not (has_agent and has_memory):
        return False
    for ex in EXCLUDE_TERMS:
        if ex.lower() in text:
            return False
    return True

def parse_arxiv_id(link):
    m = re.search(r'abs/([^/\s]+)', link)
    return m.group(1) if m else None

def clean_summary(text):
    text = re.sub(r'\s+', ' ', text).strip()
    if len(text) > 600:
        text = text[:600] + "..."
    return text

all_papers = {}
seen_ids = set()

for cat, url in FEEDS.items():
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'hermes-arxiv-agent/1.0'})
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = resp.read()
        root = ET.fromstring(data)
        ns = {
            'dc': 'http://purl.org/dc/elements/1.1/',
            'arxiv': 'http://arxiv.org/schemas/atom',
        }
        for item in root.findall('.//item'):
            title_el = item.find('title')
            desc_el = item.find('description')
            link_el = item.find('link')
            creator_el = item.find('dc:creator', ns)
            date_el = item.find('dc:date', ns)
            
            title = title_el.text.strip() if title_el is not None and title_el.text else ""
            description = desc_el.text.strip() if desc_el is not None and desc_el.text else ""
            link = link_el.text.strip() if link_el is not None and link_el.text else ""
            creator = creator_el.text.strip() if creator_el is not None and creator_el.text else ""
            date = date_el.text.strip() if date_el is not None and date_el.text else ""
            
            arxiv_id = parse_arxiv_id(link)
            if not arxiv_id or arxiv_id in seen_ids:
                continue
            
            if matches_keywords(title, description):
                seen_ids.add(arxiv_id)
                all_papers[arxiv_id] = {
                    "arxiv_id": arxiv_id,
                    "title": title,
                    "authors": creator,
                    "summary": clean_summary(description),
                    "categories": cat,
                    "pdf_url": f"https://arxiv.org/pdf/{arxiv_id}",
                    "rss_date": date,
                    "source_feed": cat,
                }
                print(f"[MATCH] {arxiv_id}: {title[:80]}")
    except Exception as e:
        print(f"[ERROR] {cat}: {e}")

print(f"\n=== TOTAL MATCHED: {len(all_papers)} papers ===")

today = time.strftime("%Y-%m-%d")
paper_list = list(all_papers.values())
paper_list.sort(key=lambda p: p["arxiv_id"], reverse=True)

output = {
    "date": today,
    "new_count": len(paper_list),
    "pending_count": len(paper_list),
    "excel_file": "/opt/data/home/hermes-arxiv-agent/papers_record.xlsx",
    "papers_dir": "/opt/data/home/hermes-arxiv-agent/papers",
    "new_papers": [],
    "papers_to_process": paper_list,
    "wechat_msg": "",
    "source": "rss_fallback"
}

with open("new_papers.json", "w") as f:
    json.dump(output, f, ensure_ascii=False, indent=2)

print(f"\nSaved {len(paper_list)} papers to new_papers.json")
