# Local foundation verification

2 October 2026. Mock evidence only.

## Source preservation

The original starter ZIP is stored in `01-Input/starter-vision/`, with 127 extracted entries preserved byte-for-byte. SHA-256 is recorded in SOURCE.md. Workspace VISION.md distinguishes the user's request from embedded instructions/historical claims.

## Build and setup

- Pinned npm dependencies installed; package-lock.json saved with source.
- TypeScript typecheck, Vite production bundle and server compilation passed.
- `docker compose up -d --build --wait` passed directly from `02-Build/shopbot-ai` on the SMB share.
- PostgreSQL 17.6 and Node 22.22.1 container services report healthy.
- SMB chmod/symlink limitations required /tmp for native dependency installation. Docker COPY uses node ownership, fixing the shared-drive file permissions with a non-root runtime.
- Services bind to 127.0.0.1:3017 (app) and 127.0.0.1:5437 (database). Database/media named volumes persist.

## Integration suite

`npm run test:integration` passed against local PostgreSQL and through `docker compose run --rm app npm run test:integration`. One integration scenario covers parallel migration/seed, six-product catalog with unknown stock, five-product draft retention, idempotent duplicate input, conflicting reuse rejection, stale/concurrent version checks, identity-injecting/invalid quantity rejection, readiness, disabled live simulator, live mode without seed and refused live reset. Tests use isolated schemas, then remove their own schemas.

## Browser and recovery checks

Added one PTFE tape roll and one half-inch PVC elbow in the browser. Both appear in the persisted draft, total 5,300 paise. A shopping-list text is saved and receives an explicit foundation reply that natural interpretation is not yet implemented. It does not change the draft or place an order.

Recorded state: two draft lines and six inbound/outbound messages. Stopped the app; inserted one synthetic inbox message through the same service while the worker was offline; restarted. The draft and earlier history remained unchanged; the pending message was processed once, producing exactly one additional reply (eight messages, zero pending). Rebuilding directly from the workspace also preserved the same state.

Screenshot: `001-simulator.jpg` after final browser verification.

## Limits

This verifies a deterministic single-demo-store foundation. It does not establish model extraction accuracy, multi-store production isolation, WhatsApp delivery/window eligibility, payment verification, owner authentication, media quality or commercial results. No external customer data or paid API usage was used.
