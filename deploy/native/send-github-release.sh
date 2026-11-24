#!/usr/bin/env bash
set -euo pipefail
umask 077
: "${VPS_RELEASE_KEY:?Missing GitHub production SSH key}"
: "${VPS_RELEASE_HOST:?Missing VPS host}"
: "${VPS_RELEASE_KNOWN_HOST:?Missing pinned VPS host key}"
: "${GITHUB_SHA:?Missing workflow commit}"
[[ "$VPS_RELEASE_HOST" =~ ^[a-zA-Z0-9.-]+$ && "$GITHUB_SHA" =~ ^[0-9a-f]{40}$ ]]
temp=$(mktemp -d)
trap 'rm -rf -- "$temp"' EXIT
printf '%s\n' "$VPS_RELEASE_KEY" > "$temp/key"
printf '%s\n' "$VPS_RELEASE_KNOWN_HOST" > "$temp/known_hosts"
ssh_release=(ssh -T -o BatchMode=yes -o ConnectTimeout=15 -o ServerAliveInterval=15
  -o StrictHostKeyChecking=yes -o IdentitiesOnly=yes -o UserKnownHostsFile="$temp/known_hosts"
  -i "$temp/key" "shopbot-release@$VPS_RELEASE_HOST")
case "${1:-}" in
  stage)
    cd "$2"
    shopt -s nullglob
    archives=(shopbot-vps-preview-*.tar.gz)
    [[ ${#archives[@]} == 1 ]]
    archive=${archives[0]}
    sha=$(sha256sum "$archive" | cut -d ' ' -f 1)
    [[ $(cat "$archive.sha256") == "$sha  $archive" ]]
    "${ssh_release[@]}" "stage $GITHUB_SHA $sha" < "$archive"
    ;;
  activate)
    "${ssh_release[@]}" "activate $GITHUB_SHA"
    ;;
  status)
    "${ssh_release[@]}" status
    ;;
  *)
    exit 2
    ;;
esac
