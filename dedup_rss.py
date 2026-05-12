import json

with open("/opt/data/home/hermes-arxiv-agent/new_papers.json") as f:
    np_data = json.load(f)

crawled_ids = set()
try:
    with open("/opt/data/home/hermes-arxiv-agent/crawled_ids.txt") as f:
        for line in f:
            lid = line.strip()
            if lid:
                crawled_ids.add(lid)
except FileNotFoundError:
    pass

deleted_ids = set()
try:
    with open("/opt/data/home/hermes-arxiv-agent/deleted_ids.txt") as f:
        for line in f:
            lid = line.strip()
            if lid:
                deleted_ids.add(lid)
except FileNotFoundError:
    pass

all_existing = crawled_ids | deleted_ids

print(f"RSS papers: {len(np_data['papers_to_process'])}")
print(f"Existing IDs: {len(all_existing)}")

new_papers = []
for p in np_data["papers_to_process"]:
    aid = p["arxiv_id"]
    if aid in all_existing:
        print(f"[SKIP] {aid}")
    else:
        new_papers.append(p)
        print(f"[NEW] {aid}: {p['title'][:80]}")

print(f"\nTruly new: {len(new_papers)}")

np_data["papers_to_process"] = new_papers
np_data["new_count"] = len(new_papers)
np_data["pending_count"] = len(new_papers)
with open("/opt/data/home/hermes-arxiv-agent/new_papers.json", "w") as f:
    json.dump(np_data, f, ensure_ascii=False, indent=2)
print("Saved")
