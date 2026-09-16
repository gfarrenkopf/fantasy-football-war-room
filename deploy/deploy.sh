#!/usr/bin/env bash
# Builds a git ref into its own release directory, backs up and migrates the database, then
# switches the live app to it. Runs on the droplet as the `warroom` user.
#
#   deploy/deploy.sh [ref]        # deploy a branch, tag or commit (default: main)
#   deploy/deploy.sh rollback     # switch back to the previous release (run again to undo)
#
# Layout under WARROOM_ROOT (default /srv/warroom):
#   repo.git/              mirror of the GitHub repo, fetched on every deploy
#   releases/<sha>/        one built checkout per commit; the last 5 are kept
#   current -> releases/…  what warroom.service runs
#   previous -> releases/… what `rollback` switches to
#
# Nothing is switched unless the build, backup and migrations all succeed. Rollback only swaps
# code: migrations stay applied, so a release that needs a schema change must be written to run
# against both the old and the new schema.
#
# Overrides for a local dry run: WARROOM_ROOT, WARROOM_REPO, WARROOM_ENV_FILE, WARROOM_BACKUP_DIR,
# WARROOM_RESTART (e.g. `true`), WARROOM_HEALTH_URL (empty skips the health check).
set -euo pipefail

root="${WARROOM_ROOT:-/srv/warroom}"
repo_url="${WARROOM_REPO:-https://github.com/gfarrenkopf/fantasy-football-war-room.git}"
env_file="${WARROOM_ENV_FILE:-/etc/warroom/.env}"
backup_dir="${WARROOM_BACKUP_DIR:-/var/backups/warroom}"
restart_cmd="${WARROOM_RESTART:-sudo -n systemctl restart warroom}"
health_url="${WARROOM_HEALTH_URL-http://127.0.0.1:3000/}"
keep_releases=5

log() { printf '==> %s\n' "$*"; }
die() { printf 'deploy: %s\n' "$*" >&2; exit 1; }

# One deploy at a time. mkdir is atomic and, unlike flock, also exists on macOS.
lock() {
  local dir="$root/.deploy.lock"
  mkdir -p "$root/releases"
  mkdir "$dir" 2>/dev/null || die "another deploy is running (remove $dir if it isn't)"
  trap 'rmdir "$root/.deploy.lock"' EXIT
}

# Runs a command with the app's secrets (DATABASE_URL etc.) exported, without leaking them into
# npm ci or the build.
with_env() {
  [[ -r "$env_file" ]] || die "can't read $env_file"
  # shellcheck source=/dev/null
  (set -a && . "$env_file" && set +a && "$@")
}

restart_and_check() {
  log "Restarting"
  $restart_cmd
  [[ -n "$health_url" ]] || return 0
  for _ in $(seq 1 30); do
    if curl -fsS -o /dev/null "$health_url"; then
      log "Healthy: $health_url"
      return 0
    fi
    sleep 1
  done
  die "$health_url didn't respond within 30s. Check \`journalctl -u warroom -n 100\`; \`$0 rollback\` restores the previous release."
}

rollback() {
  local current previous
  current="$(readlink "$root/current" || true)"
  previous="$(readlink "$root/previous" || true)"
  [[ -n "$previous" && -d "$previous" ]] || die "no previous release to roll back to"
  log "Rolling back: $(basename "$current") -> $(basename "$previous")"
  ln -sfn "$previous" "$root/current"
  if [[ -n "$current" ]]; then ln -sfn "$current" "$root/previous"; fi
  restart_and_check
}

deploy() {
  local ref="$1" sha release current
  if [[ -d "$root/repo.git" ]]; then
    log "Fetching"
    git -C "$root/repo.git" remote update --prune
  else
    log "Cloning $repo_url"
    git clone --mirror "$repo_url" "$root/repo.git"
  fi
  sha="$(git -C "$root/repo.git" rev-parse --verify "$ref^{commit}")" || die "unknown ref: $ref"
  release="$root/releases/$sha"
  current="$(readlink "$root/current" || true)"

  if [[ "$current" == "$release" ]]; then
    log "$sha is already live"
    return 0
  fi

  # A release without the marker is left over from a failed build; start it again from scratch.
  if [[ ! -f "$release/.release-ok" ]]; then
    rm -rf "$release"
    mkdir -p "$release"
    log "Building $sha"
    git -C "$root/repo.git" archive "$sha" | tar -x -C "$release"
    echo "$sha" > "$release/REVISION"
    (cd "$release" && npm ci --no-audit --no-fund && npm run build)
    touch "$release/.release-ok"
  else
    log "Reusing the existing build of $sha"
  fi

  log "Backing up the database"
  (cd "$release" && with_env npm run db:backup -- "$backup_dir")
  log "Migrating"
  (cd "$release" && with_env npm run db:migrate)

  log "Switching to $sha"
  if [[ -n "$current" ]]; then ln -sfn "$current" "$root/previous"; fi
  ln -sfn "$release" "$root/current"
  touch "$release/.release-ok" # newest mtime = most recently deployed, for pruning

  restart_and_check
  prune
}

# Keeps the newest releases by deploy time, and never the ones current or previous point at.
# Failed builds of other commits are removed too.
prune() {
  local current previous dir kept=0
  current="$(readlink "$root/current" || true)"
  previous="$(readlink "$root/previous" || true)"
  for dir in "$root"/releases/*/; do
    dir="${dir%/}"
    if [[ -d "$dir" && ! -f "$dir/.release-ok" ]]; then
      log "Removing failed build $(basename "$dir")"
      rm -rf "$dir"
    fi
  done
  # Release names are commit shas, so ls output is safe to read line by line.
  # shellcheck disable=SC2012
  ls -1t "$root"/releases/*/.release-ok 2>/dev/null | while IFS= read -r marker; do
    dir="$(dirname "$marker")"
    if [[ "$dir" == "$current" || "$dir" == "$previous" ]] || (( kept < keep_releases )); then
      kept=$((kept + 1))
      continue
    fi
    log "Removing old release $(basename "$dir")"
    rm -rf "$dir"
  done
}

case "${1:-main}" in
  -h | --help) sed -n '2,19p' "$0" | sed 's/^# \{0,1\}//' ;;
  rollback) lock; rollback ;;
  *) lock; deploy "${1:-main}" ;;
esac
