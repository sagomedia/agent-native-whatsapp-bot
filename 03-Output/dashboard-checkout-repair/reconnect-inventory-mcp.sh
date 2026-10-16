#!/usr/bin/env bash
set -euo pipefail
socket=/home/gk-pc/.ssh/shopbot-checkout-01a142c9.sock
agent_status=0
SSH_AUTH_SOCK="$socket" ssh-add -l >/dev/null 2>&1 || agent_status=$?
if (( agent_status == 2 )); then
  if [[ -S "$socket" ]]; then rm -- "$socket"; fi
  ssh-agent -a "$socket" -s >/dev/null
fi
SSH_AUTH_SOCK="$socket" ssh-add -t 2h /home/gk-pc/.ssh/google_compute_engine
echo 'VPS key unlocked. Reconnect shopbot_catalog in Codex, or open a new chat.'
