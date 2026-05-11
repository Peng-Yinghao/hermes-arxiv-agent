#!/bin/bash
# Peer-review detection via HTML scraping of arXiv abstract pages
# Usage: bash check_peer_review.sh

cd /opt/data/home/hermes-arxiv-agent

# Get all arxiv IDs
IDS=$(python3 -c "
import json
papers = json.load(open('viewer/papers_data.json'))
print(' '.join([p['arxiv_id'] for p in papers['papers']]))
")

TOTAL=$(echo $IDS | wc -w)
CHECKED=0
PEER=0
RESULTS="{}"

# Peer review venue patterns
VENUES="neurips|nips|icml|iclr|aaai|ijcai|aistats|uai|acl|emnlp|naacl|eacl|coling|tacl|conll|cvpr|iccv|eccv|icra|rss|corl|iros|aamas|sigir|www|kdd|wsdm|icse|fse|osdi|sosp|eurosys|ccs|usenix|jmlr|tmlr|nature|science|pnas|ieee.transactions|acm.transactions|proceedings.of|accepted.at|published.in|conference.on"

echo "=== Peer-Review Detection ==="
echo "Total papers to check: $TOTAL"

for ID in $IDS; do
    CHECKED=$((CHECKED + 1))
    
    # Fetch abstract page
    HTML=$(curl -s --connect-timeout 10 -A "Mozilla/5.0 (compatible; HermesArxivAgent/1.0)" "https://arxiv.org/abs/${ID}" 2>/dev/null) || true
    
    if [ -z "$HTML" ]; then
        echo "[${CHECKED}/${TOTAL}] ${ID}: no response"
        sleep 2
        continue
    fi
    
    # Extract journal-ref and comments
    JR=$(echo "$HTML" | sed -n '/class="tablecell journal-ref"/{n;s/^[[:space:]]*//;s/<[^>]*>//g;p;q}')
    CM=$(echo "$HTML" | sed -n '/class="tablecell comments"/{n;s/^[[:space:]]*//;s/<[^>]*>//g;p;q}')
    
    COMBINED=$(echo "$JR $CM" | tr '[:upper:]' '[:lower:]')
    
    # Check for non-peer indicators
    if echo "$COMBINED" | grep -qE "preprint|under.review|submitted.to"; then
        echo "[${CHECKED}/${TOTAL}] ${ID}: preprint"
        sleep 0.3
        continue
    fi
    
    # Check for peer review venues
    VENUE=$(echo "$COMBINED" | grep -oE "(${VENUES})[^,.]*" | head -1)
    
    if [ -n "$VENUE" ]; then
        PEER=$((PEER + 1))
        echo "[${CHECKED}/${TOTAL}] ${ID}: PEER - ${VENUE}"
        # Save to JSON
        python3 -c "
import json
try:
    r = json.load(open('peer_results.json'))
except:
    r = {}
r['${ID}'] = ['✓ ${VENUE}', '${VENUE}']
json.dump(r, open('peer_results.json','w'), ensure_ascii=False)
" 2>/dev/null
    else
        echo "[${CHECKED}/${TOTAL}] ${ID}: preprint"
        python3 -c "
import json
try:
    r = json.load(open('peer_results.json'))
except:
    r = {}
r['${ID}'] = ['', '']
json.dump(r, open('peer_results.json','w'), ensure_ascii=False)
" 2>/dev/null
    fi
    
    sleep 0.3
done

echo "=== DONE ==="
echo "Checked: ${CHECKED}/${TOTAL}, Peer-reviewed: ${PEER}"
