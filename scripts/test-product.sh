#!/bin/sh
# THE TEST PRODUCT (14 Oct 2026). One command for a clean FAVOUR on this Mac,
# TEST DATA only, with the swipe jury on.
#
#   sh scripts/test-product.sh          start it for a phone walk (see TEST-PRODUCT.md)
#   sh scripts/test-product.sh --walk           start clean, run the API walk, stop
#   sh scripts/test-product.sh --browser-walk   start clean, tap through TEST-PRODUCT.md in a browser, stop
#
# It starts the in-memory fake store (127.0.0.1:8089) and the app (port 3220),
# seeds the TEST DATA, and prints the links. Stop it with Ctrl-C: the store
# lives in memory, so everything it held is gone. Nothing is written to
# production, and the app refuses to start next to a real env file.
set -eu
cd "$(dirname "$0")/.."
STORE_PORT=8089
APP_PORT=3220
for f in .env .env.local .env.development .env.development.local; do
  if [ -f "$f" ]; then
    echo "REFUSED: $f exists in $(pwd). The test product runs only in a folder with no real env file." >&2
    exit 2
  fi
done
for p in $STORE_PORT $APP_PORT; do
  if lsof -nP -iTCP:$p -sTCP:LISTEN >/dev/null 2>&1; then
    echo "REFUSED: port $p is in use. Stop what runs there first (the app keeps points in memory, so a used app gives a wrong walk)." >&2
    exit 2
  fi
done
unset ANTHROPIC_API_KEY OPENROUTER_API_KEY BLOB_READ_WRITE_TOKEN XMTP_WALLET_KEY DEPLOYER_KEY CRON_SECRET ESCROW_V2_ENABLED SESSION_ENFORCE
set -a
. scripts/review-fixture.envfile
set +a
export KV_REST_API_URL="http://127.0.0.1:$STORE_PORT"
export NEXT_PUBLIC_FAVOUR_JURY_GAME="${NEXT_PUBLIC_FAVOUR_JURY_GAME:-1}"
LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || true)"
# Next 16 serves its dev scripts only to the origins it is told about.
[ -n "$LAN_IP" ] && export FAVOUR_FIXTURE_LAN_HOST="$LAN_IP"

LOGS="$(mktemp -d)"
node scripts/fake-store.mjs --empty --fixture scripts/review-fixture.json --port $STORE_PORT >"$LOGS/store.log" 2>&1 &
STORE_PID=$!
node_modules/.bin/next dev -H 0.0.0.0 -p $APP_PORT >"$LOGS/app.log" 2>&1 &
APP_PID=$!
cleanup() { kill $APP_PID $STORE_PID 2>/dev/null || true; rm -rf "$LOGS"; }
trap cleanup EXIT INT TERM

i=0
until curl -fs "http://localhost:$APP_PORT/api/health" >/dev/null 2>&1; do
  i=$((i + 1)); [ $i -gt 90 ] && { echo "The app did not start. Log:" >&2; tail -20 "$LOGS/app.log" >&2; exit 1; }
  sleep 2
done
node scripts/review-fixture.mjs --app "http://localhost:$APP_PORT" --store "http://127.0.0.1:$STORE_PORT" >"$LOGS/seed.log" 2>&1 || { cat "$LOGS/seed.log" >&2; exit 1; }
echo "TEST DATA seeded. Store 127.0.0.1:$STORE_PORT (in memory), app port $APP_PORT, swipe jury on."

if [ "${1:-}" = "--walk" ]; then
  node scripts/test-product-walk.mjs --app "http://localhost:$APP_PORT" --store "http://127.0.0.1:$STORE_PORT"
  exit $?
fi
if [ "${1:-}" = "--browser-walk" ]; then
  node scripts/test-product-phone-walk.mjs --app "http://localhost:$APP_PORT"
  exit $?
fi

echo
echo "On this Mac:    http://localhost:$APP_PORT/__fixture/"
[ -n "$LAN_IP" ] && echo "On your phone:  http://$LAN_IP:$APP_PORT/__fixture/   (same Wi-Fi, Safari, not World App)"
echo "Script:         scripts/TEST-PRODUCT.md"
echo "Ctrl-C stops it and removes all of it."
wait $APP_PID
