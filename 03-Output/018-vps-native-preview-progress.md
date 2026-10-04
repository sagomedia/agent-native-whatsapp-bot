# Native VPS preview progress — 4 October 2026

The user authorized starting a trial on the existing e2-micro to preserve free compute eligibility. The private native preview is now running, and both older services were stopped and disabled after the new app passed its VPS smoke and restart checks. Their files and backups remain available for rollback. No paid VM upgrade, disk increase or public routing change has been made.

## Prepared release

- Branch: `codex/vps-free-tier-preview` in the managed local checkout. Latest Tamil/intent-discovery source was copied from the shared workspace without changing that workspace or its Git working-tree configuration.
- Required Node 22 build/typecheck passed; catalog cleanup tests: 4 passed; regression suite: 109 passed, 0 failed, 0 skipped, using a separate disposable local PostgreSQL database.
- Packaged release: `preview-8f06fd2bcec5`; 63,492,702 bytes compressed; 208,451,704 bytes unpacked.
- Archive SHA-256: `961e0281100a796e19edec29a10aa1312f1888101da35dc606369cfa7a221147`.
- Node 22.22.1 official Linux x64 archive verified against the vendor's checksum.
- Production dependencies, compiled app/dashboard and customer demo catalog/images included. Environment files, owner-only catalog data, runtime databases/uploads and development dependencies excluded.
- The exact package started with a 128 MB Node heap, served readiness/dashboard and produced an asynchronous synthetic reply. Its synthetic conversation survived an app restart.
- Installer, loopback-only service, reduced PostgreSQL settings, smoke check and rollback script are in `02-Build/shopbot-ai/deploy/native/`.

## Completed on the VPS

- Private backup: `/var/backups/shopbot-migration/20261004T065723Z`. Five SQLite copies passed integrity checks. Configuration and media retained on the same server with restricted access; no values or customer rows printed. This verifies backup integrity, not a complete recovery drill.
- Debian package installation completed with exit code 0: PostgreSQL 17.11 and FFmpeg 7.1.5. The preview uses a separate new database; legacy SQLite data remains untouched.
- Direct SSH succeeded using the user's existing encrypted key after they unlocked it in a private local agent for one hour. The existing project SSH public-key authorization was refreshed for one hour.
- SCP transfer completed, and the archive SHA-256 matched before extraction into `/opt/shopbot-vps/releases/preview-8f06fd2bcec5`. The prepared installer completed with exit code 0.
- `shopbot-vps.service` is enabled and active. Readiness returned ready / mock; the dashboard loaded; an asynchronous synthetic conversation produced a reply. Synthetic message `ebdc2d43-03b6-4cf2-a55e-f58a0ac556f4` and its reply survived an app restart; pending jobs: 0; unexpected service restarts: 0.
- `ksmc-counter.service` and `sago-agent-native.service` are now inactive and disabled. Their source, databases, media, environment, service files and tunnel configurations were retained.
- App listener: `127.0.0.1:3017`; PostgreSQL: `127.0.0.1:5432`. No listeners remain on the old app ports 8097/8099. `/etc/shopbot-vps.env` is root-owned mode 600; media/data directory is service-owned mode 700.
- After switching services: app service 46,657,536 bytes (about 44.5 MiB), PostgreSQL service 63,066,112 bytes (about 60.1 MiB), 404 MiB available RAM, 106 MiB swap used and 1.8 GB free disk. This is a mock-preview measurement, not a production AI/photo/voice load test.
- The private VPS dashboard was verified in Chrome through a localhost-only SSH tunnel at `http://127.0.0.1:3018/`, showing the retained synthetic conversation. The tunnel has a maximum one-hour lifetime from startup and creates no public endpoint.

## Remaining work

The user enabled the ChatGPT extension's local-file access, and automated file selection began working. Google SSH-in-browser then failed its file-transfer authorization. The user allowed popups for `https://ssh.cloud.google.com`, then requested a switch to MCP/direct access. Direct SSH/SCP completed the transfer and deployment.

Google's official Compute Engine remote MCP at `https://compute.googleapis.com/mcp` authenticated with the existing gcloud account, listed 29 tools and returned the existing VM as RUNNING / e2-micro. Google's local `@google-cloud/gcloud-mcp@0.5.3` also initialized and successfully described the VM. It is installed on the local computer and configured as the enabled `google-cloud` server in Codex. No new IAM grants, account credentials, cloud resources or API enablement were needed. [Google gcloud MCP](https://github.com/googleapis/gcloud-mcp), [Compute Engine MCP](https://docs.cloud.google.com/compute/docs/use-compute-engine-mcp).

The gcloud MCP deliberately blocks SSH commands; direct SSH/SCP was used for deployment. The user unlocked the existing local key for one hour without sharing its passphrase. New native MCP tools have not appeared in this already running chat's tool catalog yet; MCP protocol initialization/read operations were verified separately.

Rollback: `sudo bash /opt/shopbot-vps/current/deploy/rollback.sh`. This stops/disables the new app and restores both older services. The new PostgreSQL database and media are retained; stop the new PostgreSQL cluster separately if abandoning this preview. A full backup restore drill remains outstanding.

The running private preview uses mock mode, AI off, paid inference false and budget zero. Gemini-key placement/free-only AI enablement, authenticated public browser access and verified WhatsApp delivery are subsequent steps. The mock simulator remains on loopback. Existing Cloudflare bot routes still target the old applications; they have not been switched to this release. The old native tunnel also has a desktop connector, so its public hostname does not reliably represent this VPS.
