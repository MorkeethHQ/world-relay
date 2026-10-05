#!/bin/sh
# START THE APP FOR THE LOCAL TEST DATA REVIEW (2026-10-05).
# It runs `next dev` against the in-memory fake store and nothing else.
#
# It refuses to start if an env file of the real app is in this folder: Next
# loads .env.local by itself, and that file holds the real model key and store
# address. The fixture must never see them.
set -eu
cd "$(dirname "$0")/.."
for f in .env .env.local .env.development .env.development.local; do
  if [ -f "$f" ]; then
    echo "REFUSED: $f exists in $(pwd). The fixture runs only in a folder with no real env file." >&2
    exit 2
  fi
done
# Nothing inherited from the shell may reach a model, a blob store or a chain.
unset ANTHROPIC_API_KEY OPENROUTER_API_KEY BLOB_READ_WRITE_TOKEN XMTP_WALLET_KEY DEPLOYER_KEY CRON_SECRET ESCROW_V2_ENABLED SESSION_ENFORCE
set -a
. scripts/review-fixture.envfile
set +a
echo "TEST DATA fixture: app on http://localhost:${PORT:-3210}, store ${KV_REST_API_URL} (the local fake)."
exec node_modules/.bin/next dev -p "${PORT:-3210}"
