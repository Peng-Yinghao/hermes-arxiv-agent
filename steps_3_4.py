import json, openpyxl, os, time
from datetime import datetime

os.chdir("/opt/data/home/hermes-arxiv-agent")

today = time.strftime("%Y-%m-%d")

# Load new_papers.json
with open("new_papers.json") as f:
    np_data = json.load(f)

# Generate summary_cn for the paper (based on the abstract)
# Abstract: LLM agents that operate over long context depend on external memory
# to accumulate knowledge over time. However, existing methods typically store
# each observation as a single deterministic conclusion, even though observations
# are inherently partial and potentially ambiguous. This introduces self-reinforcing
# error. The paper proposes "Belief Memory" - storing observations as probabilistic
# beliefs rather than deterministic conclusions, allowing agents to track uncertainty
# and revise prior judgments when new evidence emerges.

summary_cn_map = {
    "2605.05583": (
        "本文提出Belief Memory框架，针对LLM智能体在部分可观测环境下长期记忆的确定性偏差问题，"
        "将观测信息存储为概率化信念而非单一结论。该方法使智能体能够保留不确定性，在新证据出现时"
        "动态修正先前判断，从而避免自强化错误，提升长期决策的鲁棒性与记忆可靠性。"
    ),
}

for p in np_data["papers_to_process"]:
    aid = p["arxiv_id"]
    if aid in summary_cn_map:
        p["summary_cn"] = summary_cn_map[aid]
        print(f"[summary_cn] {aid}: {summary_cn_map[aid][:60]}...")

# Update Excel
wb = openpyxl.load_workbook("papers_record.xlsx")
ws = wb.active

# Find column indices from header
headers = {}
for col_idx, cell in enumerate(ws[1], 1):
    if cell.value:
        headers[cell.value.strip()] = col_idx

print(f"Excel columns: {list(headers.keys())}")

arxiv_id_col = headers.get("arxiv_id")
summary_cn_col = headers.get("summary_cn")
crawled_date_col = headers.get("crawled_date")
title_col = headers.get("title")
authors_col = headers.get("authors")
summary_col = headers.get("summary")

if not arxiv_id_col:
    print("ERROR: no arxiv_id column found!")
    exit(1)

# Build arxiv_id -> row map
id_to_row = {}
for row_idx in range(2, ws.max_row + 1):
    aid = ws.cell(row=row_idx, column=arxiv_id_col).value
    if aid:
        id_to_row[aid.strip()] = row_idx

print(f"Excel has {len(id_to_row)} rows")

# Update or append
for p in np_data["papers_to_process"]:
    aid = p["arxiv_id"]
    
    if aid in id_to_row:
        row = id_to_row[aid]
        # Update summary_cn
        if summary_cn_col and "summary_cn" in p:
            ws.cell(row=row, column=summary_cn_col).value = p["summary_cn"]
            print(f"[UPDATE] {aid} row={row}: summary_cn")
        # Update crawled_date
        if crawled_date_col:
            ws.cell(row=row, column=crawled_date_col).value = today
            print(f"[UPDATE] {aid} row={row}: crawled_date={today}")
    else:
        # Append new row
        new_row = ws.max_row + 1
        if arxiv_id_col:
            ws.cell(row=new_row, column=arxiv_id_col).value = aid
        if title_col:
            ws.cell(row=new_row, column=title_col).value = p.get("title", "")
        if authors_col:
            ws.cell(row=new_row, column=authors_col).value = p.get("authors", "")
        if summary_col:
            ws.cell(row=new_row, column=summary_col).value = p.get("summary", "")
        if summary_cn_col:
            ws.cell(row=new_row, column=summary_cn_col).value = p.get("summary_cn", "")
        if crawled_date_col:
            ws.cell(row=new_row, column=crawled_date_col).value = today
        print(f"[APPEND] {aid} row={new_row}")

# Save
wb.save("papers_record.xlsx")
print("Excel saved")

# Sort and dedup crawled_ids.txt
all_ids = set()
try:
    with open("crawled_ids.txt") as f:
        for line in f:
            lid = line.strip()
            if lid:
                all_ids.add(lid)
except FileNotFoundError:
    pass

for p in np_data["papers_to_process"]:
    all_ids.add(p["arxiv_id"])

sorted_ids = sorted(all_ids)
with open("crawled_ids.txt", "w") as f:
    for aid in sorted_ids:
        f.write(aid + "\n")
print(f"crawled_ids.txt updated: {len(sorted_ids)} IDs")

# Update new_papers.json with summary_cn
with open("new_papers.json", "w") as f:
    json.dump(np_data, f, ensure_ascii=False, indent=2)
print("new_papers.json updated with summary_cn")
