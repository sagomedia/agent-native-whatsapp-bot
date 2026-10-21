#!/usr/bin/env bash
set -euo pipefail
if [[ -n "${SHOPBOT_MCP_SSH_AUTH_SOCK:-}" ]]; then
  export SSH_AUTH_SOCK="$SHOPBOT_MCP_SSH_AUTH_SOCK"
fi
if ! ssh-add -l >/dev/null 2>&1; then
  echo 'ShopBot inventory MCP needs the VPS SSH key unlocked in your local terminal. Reconnect after unlocking; do not put its passphrase in chat or config.' >&2
  exit 75
fi
exec ssh -T -o BatchMode=yes -o ConnectTimeout=10 -o IdentitiesOnly=yes \
  -o StrictHostKeyChecking=yes -o HostKeyAlias=compute.3402163578094652833 \
  -o UserKnownHostsFile="$HOME/.ssh/google_compute_known_hosts" \
  -i "$HOME/.ssh/google_compute_engine" gk-pc@34.28.153.242 \
  'sudo -n -u shopbot-vps -- /usr/local/bin/shopbot-catalog-mcp'
