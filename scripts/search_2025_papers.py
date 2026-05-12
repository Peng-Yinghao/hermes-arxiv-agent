#!/usr/bin/env python3
"""Search arXiv for 2025-2026 Agent Memory papers."""
import urllib.request
import xml.etree.ElementTree as ET
import time
import json
import sys

NS = {'a': 'http://www.w3.org/2005/Atom'}

QUERY = 'all:agent+AND+all:memory+ANDNOT+(all:quantization+OR+all:GPU+OR+all:hardware+OR+all:FPGA+OR+all:binarization)'
ENDPOINTS = [
    'https://export.arxiv.org/api/query',
    'http://export.arxiv.org/api/query',
]

def fetch_page(start, max_results=50):
    for ep in ENDPOINTS:
        url = f"{ep}?search_query={QUERY}&start={start}&max_results={max_results}&sortBy=submittedDate&sortOrder=descending"
        try:
            req = urllib.request.Request(url, headers={
                'User-Agent': 'HermesAgent/1.0 (https://github.com/Peng-Yinghao/hermes-arxiv-agent)'
            })
            with urllib.request.urlopen(req, timeout=15) as resp:
                return resp.read()
        except Exception as e:
            print(f"  {ep}: {e}", file=sys.stderr)
            continue
    return None

all_papers = []
for start in range(0, 200, 50):
    print(f"Fetching start={start}...", file=sys.stderr)
    data = fetch_page(start)
    if data is None:
        print(f"  All endpoints failed at start={start}", file=sys.stderr)
        break
    
    root = ET.fromstring(data)
    entries = root.findall('a:entry', NS)
    if not entries:
        print(f"  No more results", file=sys.stderr)
        break
    
    for entry in entries:
        title = entry.find('a:title', NS).text.strip().replace('\n', ' ')
        raw_id = entry.find('a:id', NS).text.strip()
        full_id = raw_id.split('/abs/')[-1] if '/abs/' in raw_id else raw_id
        arxiv_id = full_id.split('v')[0]
        published = entry.find('a:published', NS).text[:10]
        
        # Only keep 2025-2026
        if not (published.startswith('2025') or published.startswith('2026')):
            continue
        
        updated = entry.find('a:updated', NS).text[:10]
        authors = ', '.join(a.find('a:name', NS).text for a in entry.findall('a:author', NS))
        summary = entry.find('a:summary', NS).text.strip().replace('\n', ' ')
        cats = ', '.join(c.get('term') for c in entry.findall('a:category', NS))
        
        all_papers.append({
            'arxiv_id': arxiv_id,
            'title': title,
            'authors': authors,
            'published': published,
            'updated': updated,
            'categories': cats,
            'summary': summary
        })
    
    print(f"  Got {len(entries)} entries, kept {len([p for p in all_papers if p['published'] >= '2025'])} total 2025+", file=sys.stderr)
    time.sleep(3)

print(json.dumps(all_papers, ensure_ascii=False, indent=2))
