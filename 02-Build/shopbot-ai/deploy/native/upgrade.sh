#!/usr/bin/env bash
set -euo pipefail
if [[ $(id -u) != 0 ]]; then echo 'Run with sudo.' >&2; exit 1; fi
release=$(cd "$(dirname "$0")/.." && pwd)
[[ "$release" =~ ^/opt/shopbot-vps/releases/preview-[a-f0-9]{12}$ ]]
test -f "$release/manifest.json"
test -x "$release/node/bin/node"
test -f "$release/app/dist/apps/server/src/index.js"
test -L /opt/shopbot-vps/current
test -f /etc/shopbot-vps.env
available=$(df --output=avail -k / | tail -1 | tr -d ' ')
database_bytes=$(runuser -u postgres -- psql -At -d shopbot_vps_preview -c 'SELECT pg_database_size(current_database())')
required_kib=$(( (database_bytes * 2 + 1023) / 1024 ))
(( required_kib >= 262144 )) || required_kib=262144
if (( available < required_kib )); then echo 'Insufficient free space for a database backup and 256 MiB reserve; upgrade refused.' >&2; exit 1; fi
previous=$(readlink -f /opt/shopbot-vps/current)
backup=/var/backups/shopbot-migration/owner-$(date -u +%Y%m%dT%H%M%SZ)
umask 0077
install -d -m 0700 "$backup"
cp -p /etc/shopbot-vps.env "$backup/shopbot-vps.env"
runuser -u postgres -- pg_dump --format=custom shopbot_vps_preview > "$backup/database.dump"
pg_restore --list "$backup/database.dump" >/dev/null
available=$(df --output=avail -k / | tail -1 | tr -d ' ')
if (( available < 262144 )); then echo 'Backup complete, but less than 256 MiB free; activation refused.' >&2; exit 1; fi
printf '%s\n' "$previous" > "$backup/previous-release.txt"
printf '%s\n' "$previous" > /opt/shopbot-vps/previous-release.txt
install -m 0644 "$release/deploy/shopbot-vps.service" /etc/systemd/system/shopbot-vps.service
systemctl daemon-reload
ln -s "$release" /opt/shopbot-vps/next-release
mv -Tf /opt/shopbot-vps/next-release /opt/shopbot-vps/current
systemctl restart shopbot-vps.service
readiness_deadline=$((SECONDS + 120))
while (( SECONDS < readiness_deadline )); do
  if curl --max-time 3 --fail --silent http://127.0.0.1:3017/health/ready >/dev/null; then
    echo "Upgraded to $(basename "$release"); private backup: $backup"
    exit 0
  fi
  sleep 1
done
# Schema 35 introduces reservations. Older code cannot honor those holds, so
# failing closed is safer than letting it accept stock already promised.
inventory_schema=$(runuser -u postgres -- psql -At -d shopbot_vps_preview -c 'SELECT 1 FROM schema_migrations WHERE version>=35 LIMIT 1') || inventory_schema=unknown
if [[ ! -f "$previous/app/dist/apps/server/src/services/inventory.js" && -n "$inventory_schema" ]]; then
  systemctl stop shopbot-vps.service
  echo 'Readiness failed after the inventory migration. Service stopped; previous code cannot honor reservations. Repair this release before reopening. Database and backup retained.' >&2
  exit 1
fi
echo 'Readiness failed; restoring the previous native preview.' >&2
ln -s "$previous" /opt/shopbot-vps/next-release
mv -Tf /opt/shopbot-vps/next-release /opt/shopbot-vps/current
systemctl restart shopbot-vps.service
exit 1
