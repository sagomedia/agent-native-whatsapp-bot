#!/bin/bash
set -euo pipefail
umask 077
if [[ $(id -u) != 0 ]]; then echo 'Run this installer with sudo.' >&2; exit 1; fi
release=$(cd "$(dirname "$0")/.." && pwd)
test -f "$release/manifest.json"
test -x "$release/node/bin/node"
test -f "$release/app/dist/apps/server/src/index.js"
if [[ ! -d /var/backups/shopbot-migration ]]; then
  echo 'Create and verify the legacy data/configuration backup first.' >&2; exit 1
fi
available=$(df --output=avail -k / | tail -n 1)
if (( available < 1400000 )); then echo 'Less than 1.4 GB free; review capacity before installation.' >&2; exit 1; fi

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends postgresql-17 ffmpeg
if ! id shopbot-vps >/dev/null 2>&1; then
  useradd --system --user-group --home-dir /var/lib/shopbot-vps --shell /usr/sbin/nologin shopbot-vps
fi
install -d -m 0700 -o shopbot-vps -g shopbot-vps /var/lib/shopbot-vps /var/lib/shopbot-vps/media

# This host's audit confirmed PostgreSQL was absent before this deployment.
# Refuse to retune another installation if the expected new cluster is missing.
test -f /etc/postgresql/17/main/postgresql.conf
install -m 0644 "$release/deploy/postgresql-preview.conf" /etc/postgresql/17/main/conf.d/shopbot-preview.conf
systemctl restart postgresql@17-main.service

python3 - <<'PY'
from pathlib import Path
import secrets, subprocess
env=Path('/etc/shopbot-vps.env')
if not env.exists():
    password=secrets.token_hex(24)
    sql="""DO $$ BEGIN
IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='shopbot_vps') THEN
CREATE ROLE shopbot_vps LOGIN;
END IF;
END $$;
ALTER ROLE shopbot_vps PASSWORD '%s';
""" % password
    subprocess.run(['runuser','-u','postgres','--','psql','-v','ON_ERROR_STOP=1'],input=sql,text=True,check=True,cwd='/tmp',stdout=subprocess.DEVNULL)
    exists=subprocess.check_output(['runuser','-u','postgres','--','psql','-Atc',"SELECT 1 FROM pg_database WHERE datname='shopbot_vps_preview'"],text=True,cwd='/tmp').strip()
    if not exists:
        subprocess.run(['runuser','-u','postgres','--','createdb','--owner=shopbot_vps','shopbot_vps_preview'],check=True,cwd='/tmp')
    env.write_text('\n'.join([
        'APP_MODE=mock','HOST=127.0.0.1','PORT=3017',
        'DATABASE_URL=postgresql://shopbot_vps:'+password+'@127.0.0.1:5432/shopbot_vps_preview',
        'MEDIA_DIR=/var/lib/shopbot-vps/media',
        'ALLOW_LOCAL_AI_TEST=false','ALLOW_FREE_INFERENCE=false',
        'ALLOW_PAID_INFERENCE=false','AI_BUDGET_USD=0',
        'AI_QUOTA_PROJECT=invisible-erp','AI_MODEL=gemini-3.5-flash-lite',
        'WHATSAPP_PLANNING_PAISE=50','GEMINI_API_KEY=',''
    ]))
    env.chmod(0o600)
else:
    print('Existing private environment retained.')
PY

install -d -m 0755 /opt/shopbot-vps
if [[ -L /opt/shopbot-vps/current ]]; then
  readlink -f /opt/shopbot-vps/current > /opt/shopbot-vps/previous-release.txt
fi
ln -sfn "$release" /opt/shopbot-vps/current
install -m 0644 "$release/deploy/shopbot-vps.service" /etc/systemd/system/shopbot-vps.service
systemctl daemon-reload
systemctl enable --now shopbot-vps.service
for attempt in $(seq 1 30); do
  if curl --fail --silent http://127.0.0.1:3017/health/ready >/dev/null; then
    echo 'ShopBot private preview is ready on 127.0.0.1:3017.'
    exit 0
  fi
  sleep 1
done
echo 'Preview readiness failed. Legacy applications have not been stopped by this installer.' >&2
exit 1
