#!/usr/bin/env bash
# Seeds the comeback-2026 campaign's 4 tasks. LIVE MUTATION — writes to prod Redis.
# ADMIN_SECRET is read from the environment, never from a file in the repo.
set -euo pipefail
BASE="${BASE:-https://world-relay.vercel.app}"
: "${ADMIN_SECRET:?export ADMIN_SECRET first}"
DIR="$(cd "$(dirname "$0")" && pwd)"
# /api/seed skips any task whose first 80 chars already exist, so re-running is safe.
python3 -c "
import json,os,sys
d=json.load(open(os.path.join('$DIR','seed-comeback.json')))
d.pop('_comment',None); d['secret']=os.environ['ADMIN_SECRET']
sys.stdout.write(json.dumps(d))" \
 | curl -s -X POST "$BASE/api/seed" -H 'Content-Type: application/json' --data-binary @- \
 | python3 -m json.tool
