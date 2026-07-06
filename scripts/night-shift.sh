#!/bin/zsh
# FAVOUR night shift — unattended Claude Code triage run (launchd 05:00).
# Fresh session each night, night-only permission settings (deny git push,
# deny money scripts, deny .env), hard budget cap. Report lands in the vault.
set -u
cd "$HOME/CODE/world-relay"

# Auth: the Max-plan claude.ai login (keychain is available in the gui launchd
# domain while Oscar is logged in) — verified working headless Jul 6. NO API
# key on purpose: setting one would silently switch billing from subscription
# to per-token API. The 05:00 slot uses quota that is idle anyway.
unset ANTHROPIC_API_KEY
# ~/.local/bin FIRST — that is where `claude` lives. Omitting it was why the
# launchd run died with `command not found: claude` (the login shell added it,
# but this hard PATH reset dropped it again).
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

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
