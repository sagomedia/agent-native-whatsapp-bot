#!/bin/sh
set -eu
cd /opt/shopbot-vps/current/app
exec /opt/shopbot-vps/current/node/bin/node --env-file=/etc/shopbot-catalog-mcp.env dist/apps/server/src/mcp/stdio.js
