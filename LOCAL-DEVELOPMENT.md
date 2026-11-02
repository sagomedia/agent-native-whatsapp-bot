# Change and test ShopBot locally

GitHub contains the application code. The shop inventory, uploaded media, conversation/order database and private environment are separate runtime data. Local development uses its own PostgreSQL databases; pulling code neither copies nor resets the VPS.

## Prepared development checkout on this computer

`/home/gk-pc/projects/shopbot-inventory-dev/02-Build/shopbot-ai`

Node 22, npm and FFmpeg are available. A separate native PostgreSQL cluster is configured through private `.env` values, with development database `shopbot_dev`, disposable test database `shopbot_local_test`, and port 55440. The app uses localhost:3018. The earlier project checkout is preserved.

```bash
cd /home/gk-pc/projects/shopbot-inventory-dev
# Keep local changes on a branch. Never discard uncommitted work to update.
git status
git pull --ff-only
cd 02-Build/shopbot-ai
npm ci
npm run local:db -- start
npm run build
npm run dev
```

Open http://localhost:3018. This page is the offline development preview. Backend edits restart automatically. In another terminal, `npm run dev:dashboard` rebuilds dashboard changes; refresh the browser after rebuilding. Stop the app with Ctrl+C. Stop only the local database with `npm run local:db -- stop`. Database files persist across restarts.

On another computer, install PostgreSQL/FFmpeg and supported Node 22, create separate local development and test databases, copy `.env.example` to `.env`, and set the matching URLs. The optional `local:db` helper requires an initialized PostgreSQL cluster and its `POSTGRES_BIN_DIR`, `POSTGRES_DATA_DIR`, `POSTGRES_SOCKET_DIR` and `POSTGRES_PORT` paths. Existing Docker Compose setup remains an alternative.

## Automated checks before deploying

```bash
npm run build
npm run test:local
python3 -m unittest discover -s scripts -p test_catalog_cleanup.py
```

`test:local` reads `TEST_DATABASE_URL` from `.env`, requires a loopback PostgreSQL database ending in `_test`, and leaves the normal development database alone. Tests create/drop their own schemas. Do not use a tunnel to a merchant database for these commands.

## Real Gemini text, voice and image tests

The owner approved reuse of the existing Gemini key in private `.env.ai`, with a separate local cumulative US$0.50 ceiling. `.env` and `.env.ai` have mode 0600 and remain ignored by Git. No WhatsApp credentials are needed for these tests. On a new device, copy `.env.ai.example` to `.env.ai`, set the approved key, positive budget and `ALLOW_PAID_INFERENCE=true`. Do not paste keys into a chat or commit them.

```bash
npm run eval:local -- --preflight
npm run eval:local -- --fixtures tests/fixtures/local-shopping.json
```

The evaluation uses the same unified understanding and inventory grounding path as WhatsApp, but no WhatsApp transport. The budget persists across runs; restarting or creating another chat does not reset it. Results and validated operations are written under ignored `artifacts/unified-evaluation/report.json`.

`LOCAL_CATALOG_SNAPSHOT=./data/catalog-snapshot.json` selects the prepared inventory-only snapshot. It preserves actual names, specifications, prices, units and photo references, without customer conversations, orders or production credentials. It imports into a synthetic store in the separate test schema. Snapshot stock/prices may become stale; these are test facts, not live availability. Without this setting, evaluation uses the bundled synthetic catalog.

For new recordings, create a private fixture file with this shape and run it with `eval:local -- --fixtures /absolute/path/cases.json`:

```json
{"cases":[{"id":"my-voice-order","messages":[{"kind":"audio","path":"./recordings/order.ogg","mimeType":"audio/ogg"}],"expected":{"orders":0}}]}
```

Media paths are relative to the case file. Keep private recordings under ignored `recordings/` or `data/`. Text uses `{"kind":"text","text":"..."}`; images use `{"kind":"image","path":"...","mimeType":"image/jpeg","text":"caption"}`. A test may include several messages to exercise add, change and remove behavior. Product approval and final submission remain distinct.

## Actual WhatsApp and full owner dashboard locally

The prepared private `.env.whatsapp` reuses the existing number, Meta connection and dashboard password. The product snapshot includes the current 343 inventory records and the photographs used by those records. The local database is independent: local orders and catalog changes do not change live shop data. Existing VPS customer history is not copied. Each database/schema retains its own inference ledger; the local WhatsApp channel and CLI evaluation each have a cumulative $0.50 ceiling.

```bash
npm run local:db -- start
npm run whatsapp:check
npm run whatsapp:local
```

The helper verifies the local database, recipient allowlist, webhook challenge and signature before opening an SSH reverse tunnel. It temporarily routes the existing public WhatsApp and owner dashboard addresses to this computer. Meta's webhook subscription and the original Cloudflare configuration remain unchanged. Send a fresh WhatsApp message from the configured test phone. Open https://shopbot-preview.sagoautomation.tech/owner and sign in with the existing password; this session's products, chats and orders are local. Old VPS buttons reference the VPS conversation state, so begin a fresh local shopping conversation.

Backend edits restart locally while this command runs. In another terminal, `npm run dev:dashboard` watches dashboard changes. The ordinary `npm run dev` preview must be stopped first because both use port 3018. Logs are in private `data/logs/local-whatsapp.log`.

Press Ctrl+C to restore the VPS route before the local backend stops. The VPS watchdog also restores after a tunnel/backend failure, and a session expires after six hours. A VPS reboot removes the runtime-only routing override. Verify recovery from another terminal if necessary:

```bash
npm run whatsapp:restore
```

The VPS app stays available for the existing authenticated inventory MCP integration throughout local testing. Other WhatsApp senders are excluded by the local test-recipient list while local mode is active. The dashboard requires a fresh sign-in after switching databases. Do not deploy or change Cloudflare routing while a local session is active.

The route guard is installed on the prepared VPS at `/usr/local/lib/shopbot-local-route.py`. For another VPS, inspect its ingress layout before adapting `deploy/native/local-route.py`; it deliberately refuses an unexpected layout. This computer's private profile configures the project/instance/zone/user and gcloud executable. gcloud creates a private temporary SSH key under ignored `data/`; the session starts using the already authenticated Google account.

To explicitly refresh the local inventory after exporting a new inventory-only snapshot, stop the local session and run `npm run local:catalog`. This overwrites local catalog/stock/price edits with snapshot facts, preserves local conversations/orders and never reads the VPS customer database. Pulling code does not refresh the snapshot automatically. Do not refresh stock while local test orders have reservations; use a fresh development database or resolve those test orders first.

## Normal change cycle

Pull the verified GitHub state, create a feature branch, change code, run local fixtures/checks, and push a PR. Deploy a reviewed build to the VPS only when ready for connected acceptance. A GitHub push alone does not change the running VPS release.
