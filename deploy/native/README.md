# Run and upgrade the existing Google Cloud VPS

ShopBot runs as `shopbot-vps.service` on Compute Engine VM `sago-counter-ksmc` in project `hermes-mcp-test`, zone `us-central1-a`. The application listens on loopback port 3017, uses native PostgreSQL (`shopbot_vps_preview`), and reads its private configuration from `/etc/shopbot-vps.env`. Media lives in `/var/lib/shopbot-vps/media`. The existing Cloudflare tunnel serves the [owner dashboard](https://shopbot-preview.sagoautomation.tech/owner) and public WhatsApp webhook and media on `demo.sagoautomation.tech`.

## Check the running service

On the authorized VPS session, use:

```bash
systemctl is-active shopbot-vps.service cloudflared.service
readlink -f /opt/shopbot-vps/current
curl -fsS --max-time 5 http://127.0.0.1:3017/health/ready
df -h /opt/shopbot-vps
```

Sign in to the owner dashboard and inspect `/api/owner/release` for the actual fingerprint and active features. The VM uses an immutable release directory named `preview-<digest>`; that name is part of the packaging contract. Before phone testing or deployment, end any [connected local session](../../LOCAL-DEVELOPMENT.md) so the shared number’s webhook reaches the VPS.

## Upgrade an authorized release

1. From a clean reviewed commit on the build machine, install dependencies, run the [local checks](../../LOCAL-DEVELOPMENT.md#verify-a-source-change), and verify hosted CI. Run `npm run release:manifest` from the repository root. It rebuilds and verifies the artifacts against the source and dependency lock. Record commit, artifact fingerprint and CI result.
2. Record the active release from the VPS and verify runtime/dependency compatibility. To reuse a matching installed runtime, run `python3 deploy/native/package-release.py --reuse-release "$active_release" --output-dir "$output_dir"` on the build machine, substituting the actual release ID and a new local output directory. For a complete runtime bundle, use `--node-archive` and `--node-shasums` with the pinned Node Linux x64 archive and checksums instead of `--reuse-release`. Record the resulting archive SHA-256. The cleanup that removes the simulator dependencies changes the lockfile and requires a complete runtime bundle for its first deployment.
3. Transfer the archive to private staging on the VPS. For a reuse bundle, run `sudo python3 stage-reused.py "$archive" "$sha256"` using the reviewed staging helper and expected digest. For a complete bundle, verify the checksum and stage its immutable release directory under `/opt/shopbot-vps/releases/`. Verify the candidate against a disposable populated restore and check free disk. Preserve the previous release, matching private configuration and media, and a verified database backup with an off-host copy.
4. Activate by running `sudo bash "$staged_release/deploy/upgrade.sh"` on the VPS using the candidate’s absolute release directory. The helper backs up the database and configuration, switches `/opt/shopbot-vps/current`, restarts the service and checks readiness. It operates on the existing connected installation. Preserve its sender/store binding, budgets, recipient policy, data and unknown delivery records.
5. Repeat the service, readiness and authenticated fingerprint checks above. Verify the shop, dashboard, catalog photos and actual webhook destination. For authorized phone acceptance, send a fresh request, choose the correct variant, edit the count and submit once. Check receipt in the dashboard and confirm each required WhatsApp delivery. Record deployment and operator acceptance separately.

## Failure and recovery

Read `journalctl -u shopbot-vps.service` privately and identify the release, migration state and affected requests. On failed readiness the upgrade helper can restore the previous app symlink. If previous code cannot honor stock reservations after migration 35, it stops the service. Repair forward or use a verified schema-compatible artifact. The database keeps its migrated state. Restore a backup into a separate database, reconcile subsequent customer activity and verify reservations before any approved data cutover.

For catalog staging, backup rehearsal and pilot evidence, use [release checks](RELEASE-CHECKS.md). For operator-specific access issues, use the [owner login procedure](DEMO-LOGIN.md), [remote MCP setup](REMOTE-MCP.md) and [catalog upload recovery](CATALOG-UPLOAD-RECOVERY.md).
