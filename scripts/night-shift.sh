#!/bin/zsh
# FAVOUR night shift — unattended Claude Code triage run (launchd 05:00).
# Fresh session each night, night-only permission settings (deny git push,
# deny money scripts, deny .env), hard budget cap. Report lands in the vault.
set -u
cd "$HOME/CODE/world-relay"

# Headless runs have no keychain/OAuth: key comes from .env.local (chmod 600).
export ANTHROPIC_API_KEY="$(grep '^ANTHROPIC_API_KEY=' .env.local | cut -d= -f2- | tr -d '\"')"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

LOG="$HOME/CODE/world-relay/scripts/.night-shift.log"
echo "=== night shift $(date -u +%Y-%m-%dT%H:%M:%SZ) ===" >> "$LOG"

claude -p "$(cat scripts/night-shift-prompt.md)" \
  --settings .claude/settings.night.json \
  --permission-mode dontAsk \
  --model sonnet \
  --max-budget-usd 3.00 \
  --output-format json >> "$LOG" 2>&1
STATUS=$?

if [ $STATUS -ne 0 ]; then
  osascript -e 'display notification "Night shift exited non-zero — check .night-shift.log" with title "FAVOUR night shift"' || true
fi
echo "=== exit $STATUS $(date -u +%Y-%m-%dT%H:%M:%SZ) ===" >> "$LOG"
