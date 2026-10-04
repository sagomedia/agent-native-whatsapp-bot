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
