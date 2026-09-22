#!/usr/bin/env bash
# Emails problems on the droplet to ALERT_EMAIL through Resend (the same AUTH_RESEND_KEY and
# EMAIL_FROM the app uses for sign-in links). Needs curl and node; reads the journal, so the
# service runs with the systemd-journal group.
#
#   warroom-alerts.sh scan            # warroom-alerts.timer, every 5 minutes: new server errors
#                                     # ("[server-error]" lines from src/instrumentation.ts),
#                                     # ESPN protocol drift ("[espn-sync] protocol-drift") and
#                                     # crashes of warroom.service since the last scan
#   warroom-alerts.sh failed <unit>   # warroom-alert-failed@.service, via OnFailure=: a unit failed
#   warroom-alerts.sh test            # sends a test email
#
# A scan sends at most one email, however many errors it finds.
set -euo pipefail

: "${AUTH_RESEND_KEY:?AUTH_RESEND_KEY is not set}"
: "${EMAIL_FROM:?EMAIL_FROM is not set}"
: "${ALERT_EMAIL:?ALERT_EMAIL is not set}"
unit="${WARROOM_ALERT_UNIT:-warroom.service}"
state_dir="${STATE_DIRECTORY:-/var/lib/warroom-alerts}"
host="$(hostname)"

send() {
  local subject="$1"
  node -e '
    const text = require("fs").readFileSync(0, "utf8");
    process.stdout.write(JSON.stringify({ from: process.env.EMAIL_FROM, to: [process.env.ALERT_EMAIL], subject: process.argv[1], text }));
  ' "$subject" |
    curl -fsS --max-time 20 https://api.resend.com/emails \
      -H "Authorization: Bearer $AUTH_RESEND_KEY" -H "Content-Type: application/json" --data-binary @- >/dev/null
  echo "Sent: $subject"
}

scan() {
  local cursor="$state_dir/cursor" lines matches count
  if [[ ! -f "$cursor" ]]; then
    # First run: start from now rather than emailing the whole history.
    journalctl -u "$unit" -n 0 --cursor-file="$cursor" -q
    echo "Started watching $unit"
    return 0
  fi
  # Read with a copy of the cursor and only keep it once any email has gone out, so a failed
  # send is retried on the next scan instead of dropping the alert.
  cp "$cursor" "$cursor.next"
  lines="$(journalctl -u "$unit" --cursor-file="$cursor.next" -q -o short-iso --no-pager)"
  # [espn-sync] covers protocol drift: ESPN changing its unofficial draft feed under us, which we
  # only ever find out about during someone's live draft.
  matches="$(grep -E '\[server-error\]|\[espn-sync\] protocol-drift|Main process exited, code=' <<<"$lines" || true)"
  if [[ -z "$matches" ]]; then
    mv "$cursor.next" "$cursor"
    return 0
  fi
  count="$(wc -l <<<"$matches" | tr -d ' ')"
  {
    echo "$count new problem line(s) from $unit on $host:"
    echo
    head -n 20 <<<"$matches"
    if ((count > 20)); then echo "… and $((count - 20)) more"; fi
    echo
    echo "Full log with stack traces: sudo journalctl -u $unit --since '-15min'"
  } | send "[draftroom] $count server problem(s) on $host"
  mv "$cursor.next" "$cursor"
}

failed() {
  local failed_unit="${1:?usage: warroom-alerts.sh failed <unit>}"
  {
    echo "$failed_unit failed on $host."
    echo
    journalctl -u "$failed_unit" -n 30 -o short-iso --no-pager
    echo
    echo "Status: sudo systemctl status $failed_unit"
  } | send "[draftroom] $failed_unit failed on $host"
}

case "${1:-}" in
  scan) scan ;;
  failed) failed "${2:-}" ;;
  test) echo "Test alert from $host at $(date -u +%FT%TZ). Alerts are working." | send "[draftroom] test alert" ;;
  *) echo "usage: warroom-alerts.sh scan | failed <unit> | test" >&2; exit 2 ;;
esac
