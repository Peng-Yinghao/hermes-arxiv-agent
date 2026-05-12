#!/usr/bin/env python3
import json, openpyxl, sys

summaries_file = sys.argv[1] if len(sys.argv) > 1 else '/tmp/hermes_tmp/summaries.json'
with open(summaries_file) as f:
    summaries = json.load(f)

wb = openpyxl.load_workbook('papers_record.xlsx')
ws = wb.active

headers = {cell.value: i for i, cell in enumerate(ws[1], 1)}
arxiv_col = headers.get('arxiv_id')
summary_col = headers.get('summary_cn')

updated = 0
for row in range(2, ws.max_row + 1):
    aid = ws.cell(row=row, column=arxiv_col).value
    if aid and aid in summaries and summaries[aid]:
        ws.cell(row=row, column=summary_col).value = summaries[aid]
        updated += 1

wb.save('papers_record.xlsx')
print(f"Updated {updated} summaries in papers_record.xlsx")
