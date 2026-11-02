#!/usr/bin/env python3
"""Temporarily bridge the existing HTTPS hosts to an SSH reverse tunnel.
Original Cloudflare configuration and credentials remain untouched. Run as a
transient systemd unit with ExecStopPost='... local-route.py restore'.
"""
import fcntl
import os
from pathlib import Path
import signal
import subprocess
import sys
import time
import urllib.request

BASE = Path('/etc/cloudflared/config.yml')
STATE = Path('/run/shopbot-local-route')
DROP = Path('/run/systemd/system/cloudflared.service.d/shopbot-local.conf')
HOSTS = ('demo.sagoautomation.tech', 'shopbot-preview.sagoautomation.tech')
PORT = 33018


def routed_config(original):
    lines = original.splitlines(keepends=True)
    host, changed = None, 0
    for i, line in enumerate(lines):
        if line.startswith('- hostname: '):
            host = line.split(': ', 1)[1].strip()
        elif line.startswith('- service:'):
            host = None
        elif line.strip() == 'service: http://127.0.0.1:3017' and host in HOSTS:
            lines[i] = line.replace(':3017', ':' + str(PORT))
            changed += 1
    if changed != 3 or original.count('ingress:\n') != 1:
        raise ValueError('The HTTPS routing layout changed; inspect it before local testing.')
    # Existing authenticated MCP integrations continue to use the VPS database.
    protected = ('- hostname: ' + HOSTS[0] + '\n'
                 "  path: ^/(mcp($|/)|\\.well-known/)\n"
                 '  service: http://127.0.0.1:3017\n'
                 '  originRequest:\n    httpHostHeader: ' + HOSTS[0] + '\n')
    return ''.join(lines).replace('ingress:\n', 'ingress:\n' + protected)


def reload_tunnel():
    subprocess.run(['systemctl', 'daemon-reload'], check=True, timeout=30)
    subprocess.run(['systemctl', 'restart', 'cloudflared.service'], check=True, timeout=45)


def restore():
    if DROP.exists():
        DROP.unlink()
        reload_tunnel()
    print('VPS HTTPS routing restored.', flush=True)


def healthy():
    try:
        with urllib.request.urlopen('http://127.0.0.1:' + str(PORT) + '/health/ready', timeout=3) as r:
            return r.status == 200 and b'"ready"' in r.read(2048)
    except Exception:
        return False


def main():
    if os.geteuid() != 0:
        raise SystemExit('Run with sudo.')
    action = sys.argv[1] if len(sys.argv) == 2 else ''
    if action == 'restore':
        restore()
        return
    if action not in ('check', 'run'):
        raise SystemExit('Use check, run or restore.')
    content = routed_config(BASE.read_text())
    if action == 'check':
        print('Routing layout verified; no routes changed.')
        return
    STATE.mkdir(mode=0o700, exist_ok=True)
    with (STATE / 'lock').open('w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if DROP.exists():
            raise SystemExit('A local route already exists; restore it first.')
        if not healthy():
            raise SystemExit('The local backend is not ready through the SSH tunnel.')
        config = STATE / 'config.yml'
        config.write_text(content)
        config.chmod(0o600)
        subprocess.run(['/usr/bin/cloudflared', '--config', str(config), 'tunnel', 'ingress', 'validate'], check=True, timeout=20)
        stop = [False]
        for signum in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
            signal.signal(signum, lambda *_: stop.__setitem__(0, True))
        try:
            DROP.parent.mkdir(parents=True, exist_ok=True)
            DROP.write_text('[Service]\nExecStart=\nExecStart=/usr/bin/cloudflared --no-autoupdate --config ' + str(config) + ' tunnel run\n')
            reload_tunnel()
            print('LOCAL_ROUTE_READY: WhatsApp and dashboard now use the local backend.', flush=True)
            failures, deadline = 0, time.monotonic() + 21600
            while not stop[0] and time.monotonic() < deadline:
                failures = 0 if healthy() else failures + 1
                if failures >= 2:
                    print('Local tunnel unavailable; restoring the VPS.', flush=True)
                    break
                time.sleep(2)
        finally:
            restore()


if __name__ == '__main__':
    main()
