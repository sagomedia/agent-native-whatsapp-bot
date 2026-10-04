#!/bin/bash
set -euo pipefail
if [[ $(id -u) != 0 ]]; then echo 'Run with sudo.' >&2; exit 1; fi
systemctl disable --now shopbot-vps.service
systemctl enable --now ksmc-counter.service sago-agent-native.service
systemctl is-active ksmc-counter.service sago-agent-native.service
echo 'Legacy services restored; new preview files and database retained.'
