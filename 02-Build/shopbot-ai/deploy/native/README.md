## Current inventory upgrade (schema 35)

Owner acceptance reserves known available stock. Collection deducts it and cancellation releases it. Existing orders become `legacy`; they are never deducted automatically. Reconcile an existing accepted order from Requests only after checking its physical stock. Unknown counts remain unknown.

Take a fresh private database/environment backup before activation. Do not revert to a pre-inventory application after schema 35: it cannot honor reservations. The upgrade helper stops the service if readiness fails across this boundary. Repair forward, or perform a separately reviewed data reconciliation with workers stopped; never restore an older backup over customer traffic. Payment receipt, approval and fulfillment remain separate facts.

The older sections below document the initial preview and its historical cutovers. Use the current source and release handoff for present features.

# Existing connected VPS: upgrade workflow

The running WhatsApp deployment uses `shopbot-vps.service`, private `/etc/shopbot-vps.env`, PostgreSQL 17 and the `/opt/shopbot-vps/current` symlink. Public webhook/media are on `demo.sagoautomation.tech`; owner access is on `shopbot-preview.sagoautomation.tech/owner`. Do not rerun the first-install script against this existing service.

Build and test off-server. Package with `package-release.py --reuse-release <active-release>` when dependencies are identical. Checksum-stage using `stage-reused.py`, run an authorized isolated replay, then use the staged `upgrade.sh`. Upgrade backs up database/configuration, switches the immutable release and checks readiness. Readiness failure restores the previous symlink, not the database. Schema-changing rollback needs separate compatibility/restore validation. Preserve the existing AI allowance, WhatsApp flags and secrets. A GitHub merge does not automatically deploy.

The sections below are historical installation guidance. Statements about channels/media or owner replies being unavailable describe those earlier stages and do not apply to the current runtime.

---

# Native e2-micro preview

This deployment uses an off-server build, the checksum-verified Node 22.22.1 Linux x64 runtime, production dependencies, PostgreSQL 17 from Debian and a bounded systemd service. It avoids loading the existing development Docker image onto the 10 GB VM. The app and database bind to loopback. No public route or WhatsApp sender is created by the installer.

Before installation, back up both older applications' configuration, SQLite databases and media. Use SQLite's online backup API and verify the copies with `PRAGMA integrity_check`; retain the service enablement states. Leave the original app/source/data in place for rollback.

From `02-Build/shopbot-ai`, run the required build, catalog tests and integration suite using a disposable database. Then run `python3 deploy/native/package-release.py --node-archive /absolute/path/to/node-v22.22.1-linux-x64.tar.xz --node-shasums /absolute/path/to/SHASUMS256.txt --output-dir /tmp/shopbot-vps-release`. The packager excludes environment files, owner-only catalog material, local data, tests and development dependencies. Inspect the produced manifest, archive size and SHA-256 before upload.

On the VPS, verify the archive hash, extract into `/opt/shopbot-vps/releases/<release-id>` with root ownership and read/execute access for the service, and run `sudo bash <release>/deploy/install.sh`. Capture the install log privately. The installer starts a mock preview with paid inference disabled and budget zero; it retains an existing `/etc/shopbot-vps.env` rather than overwriting it. The PostgreSQL settings are intended for this newly installed dedicated cluster, not another existing database server.

Run `<release>/node/bin/node <release>/deploy/smoke.mjs` for HTTP readiness, dashboard assets and an asynchronous synthetic conversation. Verify the database state survives an app restart. Only after those checks pass, stop and disable `ksmc-counter.service` and `sago-agent-native.service`, then measure free RAM, swap, disk and `MemoryCurrent` for the new service. The old tunnel routes remain configured but will have no old app origin during this trial.

Rollback: `sudo bash /opt/shopbot-vps/current/deploy/rollback.sh`. Stop the new PostgreSQL cluster too if it is only serving this preview and the trial is abandoned. Neither rollback step deletes data.

AI enablement requires separately placing the authorized existing free-tier Gemini key in the private environment and enabling `ALLOW_LOCAL_AI_TEST` and `ALLOW_FREE_INFERENCE`. Coordinate the project quota with the desktop instance, which uses a separate database ledger. Public owner access, HTTPS session handling and verified WhatsApp ingress/delivery remain separate work; never expose the unauthenticated mock simulator publicly.

## Protected owner preview

`/owner` is enabled only when the complete five-field owner configuration in
`.env.example` is supplied. Provision an Access self-hosted application for the
exact preview hostname and owner email before adding its DNS/Tunnel route. Copy
its team issuer and application AUD tag into the server environment. The server
checks the signed Access assertion on each owner request and derives the one
merchant scope from `OWNER_STORE_ID`; the browser never supplies this scope.
Keep `HOST=127.0.0.1`, `APP_MODE=mock` and `ALLOW_LOCAL_AI_TEST=false`.

The preview has conversations/takeover, requests/decisions and connections/usage.
Pause and takeover are durable and invalidate in-flight work leases. Decisions
are recorded without customer notifications. No manual reply or WhatsApp sender
exists in this release. Outbound simulator rows marked `sent` mean generated
preview output, not WhatsApp delivery; the owner view labels this explicitly.

For a subsequent prepared release, run `sudo bash <release>/deploy/upgrade.sh`.
It backs up the current environment and PostgreSQL database privately on the VM,
switches the current symlink, and restores the previous native release if
readiness fails. The backup list check does not constitute a restoration drill.
Do not use the legacy-app rollback script after public/channel cutover without
first restoring the matching DNS, Tunnel/Access and webhook configuration.


## WhatsApp text test connection

The optional channel uses the existing Meta test sender and a maximum of five
server-configured verified recipients. Configure its app ID, WABA, sender ID,
secret, verification token and API token in the root-private VPS environment.
Never include these values in the release. Receive, process and send are separate
gates; start with process/send false. The first integration uses the existing
`demo.sagoautomation.tech/webhook` callback and an exact-path ingress rule,
retaining the dashboard's owner Access policy. No new tunnel is required.

The webhook verifies exact raw-body HMAC before JSON parsing and durable inbox
commit. Workers deduplicate provider IDs and maintain scoped conversations and
a transactional outbox. Text-only replies require an approved recipient and an
open 24-hour service window; no templates, media download or marketing fan-out
are implemented. Provider acceptance, delivery, failure and unknown outcome are
distinct. Unknown sends are held rather than automatically repeated. Owner pause
and takeover also apply to channel processing and delivery. Authentication or
permission errors persist a send block. After credential repair, clear that block
only through a reviewed operator action; restarting alone does not clear it.

The current Meta app is unpublished. Its setup page warns that unpublished apps
receive only dashboard test webhooks. The Publish page currently requires a
privacy-policy URL. The factual draft is available privately to the owner at
`/api/owner/privacy-draft`. Public `/privacy` serving is off until the owner reviews
the content and approves publication. A signed test webhook proves routing and
signature validation, not delivery of real phone messages or outgoing replies.
AI remains disabled in this initial deterministic English test adapter.

For disk-constrained upgrades with unchanged production dependencies, package
with `--reuse-release <installed-release>` instead of the Node archive options.
Upload the checksummed slim archive and run `stage-reused.py` with sudo. It verifies
the archive, paths, manifest Node version and identical package/lock files, retains
space for the extracted bundle plus a backup reserve (the greater of 256 MiB and twice the current database size), and hard-links the existing immutable runtime and dependencies.
Do not modify shared runtime/dependency files in place. Then use the existing
backup/readiness/rollback upgrade script. Dependency changes require a complete
new-runtime bundle.
