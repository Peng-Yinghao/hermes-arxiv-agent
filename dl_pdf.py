import json, requests, time, os

os.chdir("/opt/data/home/hermes-arxiv-agent")

with open("new_papers.json") as f:
    data = json.load(f)

for p in data["papers_to_process"]:
    aid = p["arxiv_id"]
    url = f"https://arxiv.org/pdf/{aid}"
    path = f"papers/{aid}.pdf"
    if os.path.exists(path):
        print(f"[SKIP] {aid} already downloaded")
        continue
    print(f"Downloading {aid}...")
    try:
        r = requests.get(url, timeout=60, headers={"User-Agent": "hermes-arxiv-agent/1.0"})
        if r.status_code == 200:
            with open(path, "wb") as f:
                f.write(r.content)
            print(f"  OK: {len(r.content)} bytes -> {path}")
        else:
            print(f"  FAIL: HTTP {r.status_code}")
    except Exception as e:
        print(f"  ERROR: {e}")
    time.sleep(3)
print("Done")
