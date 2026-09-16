#!/usr/bin/env bash
# Restores a dump made by db-backup.sh into DATABASE_URL, replacing what's there.
#
#   DATABASE_URL=postgres://... scripts/db-restore.sh backups/warroom-<timestamp>.dump --yes
#
# Runs in a single transaction: if anything fails, the database is left as it was.
# PG_DOCKER_CONTAINER works as in db-backup.sh.
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is not set}"
file="${1:-}"
if [[ -z "$file" || ! -f "$file" ]]; then
  echo "Usage: scripts/db-restore.sh <dump-file> --yes" >&2
  exit 2
fi
if [[ "${2:-}" != "--yes" ]]; then
  echo "This replaces every table in the target database with the contents of $file." >&2
  echo "Re-run with --yes to continue." >&2
  exit 2
fi

pg() {
  if [[ -n "${PG_DOCKER_CONTAINER:-}" ]]; then docker exec -i "$PG_DOCKER_CONTAINER" "$@"; else "$@"; fi
}

pg pg_restore --clean --if-exists --no-owner --no-privileges --single-transaction --exit-on-error --dbname="$DATABASE_URL" < "$file"
echo "Restored $file"
