#!/usr/bin/env bash
# Starts a season job in the running app, and waits for it to finish. The secret goes to curl on
# stdin, never on a command line where `ps` would show it.
#
#   warroom-season-job.sh sunday            # warroom-season-sunday.timer: Sunday AI lineups, 11:40 ET (11.3)
#   warroom-season-job.sh early             # warroom-season-early.timer: early-kickoff alerts, every 15 minutes (11.4)
#   warroom-season-job.sh <job> --dry-run   # counts what it would do, without the model or emails
set -euo pipefail

: "${CRON_SECRET:?CRON_SECRET is not set}"
job="${1:?usage: warroom-season-job.sh sunday|early [--dry-run]}"
case "$job" in sunday | early) ;; *) echo "unknown job: $job" >&2; exit 2 ;; esac
url="http://127.0.0.1:3000/api/internal/season/$job"
[[ "${2:-}" == "--dry-run" ]] && url="$url?dryRun=1"

# The Sunday job can make a model call of up to 90 seconds per league; allow for a few dozen.
printf 'header = "Authorization: Bearer %s"\n' "$CRON_SECRET" |
  curl -fsS --max-time 3300 -X POST -K - "$url"
echo
