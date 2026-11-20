#!/usr/bin/env python3
"""Publish separate local hosts and temporarily bridge the Meta webhook.
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
LOCAL_OWNER = 'shopbot-local.sagoautomation.tech'
LOCAL_CHANNEL = 'shopbot-local-api.sagoautomation.tech'
PORT = 33018


def routed_config(original):
    lines = original.splitlines(keepends=True)
    host, path, upstreams, webhook_headers = None, None, 0, 0
    counts = {name: 0 for name in HOSTS}
    if LOCAL_OWNER in original or LOCAL_CHANNEL in original:
        raise ValueError('Local hosts must not already be in the VPS base routing.')
    for i, line in enumerate(lines):
        if line.startswith('- hostname: '):
            host = line.split(': ', 1)[1].strip()
            path = None
            if host in counts:
                counts[host] += 1
        elif line.startswith('- service:'):
            host = None
            path = None
        elif line.strip().startswith('path: '):
            path = line.strip().split(': ', 1)[1]
        elif line.strip() == 'service: http://127.0.0.1:3017' and host in HOSTS:
            upstreams += 1
        elif host == HOSTS[0] and path and (path == '^/webhook$' or path.startswith('^/(webhook|') and path.endswith(')$')) and line.strip() == 'httpHostHeader: ' + HOSTS[0]:
            webhook_headers += 1
    if upstreams != 3 or counts != {HOSTS[0]: 2, HOSTS[1]: 1} or webhook_headers != 1 or original.count('ingress:\n') != 1:
        raise ValueError('The HTTPS routing layout changed; inspect it before local testing.')
    # VPS dashboard, existing media, MCP and OAuth keep their original routes.
    # Local hostnames have no VPS fallback when this runtime override is removed.
    local = ''.join('- hostname: ' + host + '\n'
                    '  service: http://127.0.0.1:' + str(PORT) + '\n'
                    '  originRequest:\n    httpHostHeader: ' + host + '\n'
                    for host in (LOCAL_OWNER, LOCAL_CHANNEL))
    # The existing public rule can also cover privacy and media. Prepend an
    # exact webhook rule, leaving that entire existing rule byte-for-byte intact.
    webhook = ('- hostname: ' + HOSTS[0] + '\n  path: ^/webhook$\n'
               '  service: http://127.0.0.1:' + str(PORT) + '\n'
               '  originRequest:\n    httpHostHeader: ' + LOCAL_CHANNEL + '\n')
    return original.replace('ingress:\n', 'ingress:\n' + local + webhook)


def reload_tunnel():
    subprocess.run(['systemctl', 'daemon-reload'], check=True, timeout=30)
    subprocess.run(['systemctl', 'restart', 'cloudflared.service'], check=True, timeout=45)


def restore():
    if DROP.exists():
        DROP.unlink()
        reload_tunnel()
    print('VPS webhook routing restored; local test domains disabled.', flush=True)


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
    if action not in ('check', 'check-separated', 'run'):
        raise SystemExit('Use check-separated, run or restore.')
    content = routed_config(BASE.read_text())
    if action in ('check', 'check-separated'):
        print('Separate local domains verified; VPS dashboard stays on the VPS. No routes changed.')
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
            print('LOCAL_ROUTE_READY: WhatsApp test webhook uses local; dashboard: https://' + LOCAL_OWNER + '/owner; VPS dashboard stays on https://' + HOSTS[1] + '/owner.', flush=True)
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
