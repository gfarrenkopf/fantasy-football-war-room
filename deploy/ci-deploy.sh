#!/usr/bin/env bash
# The only thing the GitHub Actions deploy key can run. warroom's authorized_keys pins it:
#
#   restrict,command="/srv/warroom/current/deploy/ci-deploy.sh" ssh-ed25519 AAAA… github-actions-deploy
#
# The workflow (.github/workflows/deploy.yml) sends a commit sha as the SSH command. This accepts
# only a full sha that is already on main, then hands it to deploy.sh. A leaked key can redeploy
# main; it can't run anything else or deploy an unmerged branch.
set -euo pipefail

sha="${SSH_ORIGINAL_COMMAND:-}"
if [[ ! "$sha" =~ ^[0-9a-f]{40}$ ]]; then
  echo "ci-deploy: expected a full commit sha, got '${sha:0:80}'" >&2
  exit 2
fi

repo="${WARROOM_ROOT:-/srv/warroom}/repo.git"
git -C "$repo" remote update --prune >/dev/null
if ! git -C "$repo" merge-base --is-ancestor "$sha" main 2>/dev/null; then
  echo "ci-deploy: $sha is not on main" >&2
  exit 2
fi

exec "$(dirname "$0")/deploy.sh" "$sha"
