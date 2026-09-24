#!/usr/bin/env bash
# Starts the Sunday-morning AI lineup job (Epic 11, 11.3) in the running app, and waits for it to
# finish. The secret goes to curl on stdin, never on a command line where `ps` would show it.
#
#   warroom-season-sunday.sh           # warroom-season-sunday.timer, Sundays at 11:40 ET
#   warroom-season-sunday.sh --dry-run # counts what it would write, without the model or emails
set -euo pipefail

: "${CRON_SECRET:?CRON_SECRET is not set}"
url="http://127.0.0.1:3000/api/internal/season/sunday"
[[ "${1:-}" == "--dry-run" ]] && url="$url?dryRun=1"

# Each league can take a model call of up to 90 seconds; allow for a few dozen of them.
printf 'header = "Authorization: Bearer %s"\n' "$CRON_SECRET" |
  curl -fsS --max-time 3300 -X POST -K - "$url"
echo
