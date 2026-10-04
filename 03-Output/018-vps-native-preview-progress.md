# Native VPS preview progress — 4 October 2026

The user authorized starting a trial on the existing e2-micro to preserve free compute eligibility. The two older services remain available for rollback; neither has been stopped yet. No paid VM upgrade, disk increase or public routing change has been made.

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
- After package installation: 406 MiB available RAM, 251 MiB swap used, 2.1 GB free disk at observation. Both older applications still running. The new Node app is not running on the VPS yet.

## Remaining work

Chrome rejected automated file selection because the ChatGPT browser extension's local-file access is disabled. The user was asked to enable "Allow access to file URLs". Release transfer is pending that action.

After transfer, verify the archive checksum, install the private service, run its smoke and restart-persistence checks, stop/disable the older applications and measure the resulting memory/disk use. Keep their code, databases, environment and tunnel configuration for rollback. Leave the machine type and disk allocation unchanged.

The initial private preview defaults to mock mode, AI off, paid inference false and budget zero. Gemini-key placement/free-only AI enablement, authenticated browser access and verified WhatsApp delivery are subsequent steps. The mock simulator must remain on loopback.
