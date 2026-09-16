#!/usr/bin/env bash
# Writes a compressed, restorable dump of DATABASE_URL and verifies it can be read back.
#
#   DATABASE_URL=postgres://... scripts/db-backup.sh [output-dir]     # default: ./backups
#
# Uses pg_dump from PATH (install the Postgres client tools matching the server's major version).
# Set PG_DOCKER_CONTAINER to run pg_dump inside that Postgres container instead; DATABASE_URL is
# then resolved from inside the container (e.g. postgres://warroom:warroom@localhost:5432/warroom).
#
# Scheduling, off-box copies and retention are deployment concerns: see docs/database.md §5.
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is not set}"
out_dir="${1:-backups}"
mkdir -p "$out_dir"
file="$out_dir/warroom-$(date -u +%Y%m%dT%H%M%SZ).dump"

pg() {
  if [[ -n "${PG_DOCKER_CONTAINER:-}" ]]; then docker exec -i "$PG_DOCKER_CONTAINER" "$@"; else "$@"; fi
}

# Write to a temporary name so a failed or interrupted dump never looks like a good backup.
pg pg_dump --format=custom --no-owner --no-privileges --dbname="$DATABASE_URL" > "$file.partial"
# A dump that pg_restore can't list is corrupt.
pg pg_restore --list < "$file.partial" > /dev/null
mv "$file.partial" "$file"

echo "Backup written: $file ($(du -h "$file" | cut -f1))"
