# ShopBot reusable agent tool core

Local tool core and mock conversation runtime for the agent-native WhatsApp bot. See workspace `VISION.md` for direction and original references in `01-Input/starter-vision/`.

## Run

From this folder, copy `.env.example` to `.env`, then:

```sh
docker compose up --build -d
```

Open http://localhost:3017. PostgreSQL is bound to localhost:5437. First mock boot migrates/seeds under a startup lock. Six hardware SKUs are synthetic. Database and media use named volumes. Reboot preserves messages and drafts:

```sh
docker compose restart app
```

Stop without deleting data:

```sh
docker compose down
```

## Verify and maintain

```sh
docker compose run --rm app npm run test:integration
docker compose run --rm app npm run db:migrate
# Explicitly clears the local demo conversation/draft; refuses live mode/non-demo stores.
# Stop the app first so consumers cannot race with an intentional reset.
docker compose stop app
docker compose run --rm app npm run db:reset:mock
docker compose start app
```

The integration suite creates temporary schemas and removes only its test schemas. It requires a database user allowed to create schemas, as supplied by the local Compose setup. Do not point these developer commands at a merchant database.

## Implemented

- Six shared customer tools with strict contracts and trusted store/conversation/actor scope.
- Persistent multi-item drafts, unresolved lines, targeted clarification and atomic compound edits.
- Backend catalog prices, fractional unit steps and integer-paise totals.
- Complete reviews bound to version, hash and 15-minute expiry; trusted explicit confirmation creates one immutable shop-pending request.
- Durable inbox/pg-boss queue, per-conversation processing leases, idempotent receipts and transactional replies.
- Persisted bounded mock interpretation attempts; cached validated output can recover after an expired worker lease.
- A small React simulator using a limited English mock interpreter. Known actions skip inference.

Try a five-item request such as “I need three half-inch PVC elbows, two PTFE tape rolls, one adjustable wrench, four M4 screws and one claw hammer.” Then “yes, but make the elbows five” updates the review; “yes” submits only that review. “Price of PTFE tape” is read-only. For ambiguous “three PVC elbows”, choose a current candidate; other draft lines remain intact.

See [ARCHITECTURE.md](ARCHITECTURE.md) for tool/runtime boundaries and [STATUS.md](STATUS.md) for actual progress. The KSMC pack remains optional fixture data, not a prerequisite or a hardcoded dependency.

The simulator is unauthenticated and loopback-only. It supports one submitted request per demo conversation; reset intentionally with the documented mock-only command to start another test. Submitted requests cannot be edited. Approval, payment, stock reservation and readiness are future staff workflows. Real AI, WhatsApp, owner authentication and MCP are not connected. Cross-store scope tests are not a production isolation certification.

## Native development

Node 22.12+ (22.x), npm and local PostgreSQL are needed. On a normal local filesystem:

```sh
npm ci
npm run build
# Load DATABASE_URL, APP_MODE and MEDIA_DIR from your local environment.
node --env-file=.env dist/apps/server/src/index.js
```

This workspace is on an SMB share, which does not support all chmod/symlink operations used by npm. Prefer Docker Compose. A disposable copy under `/tmp/shopbot-ai-foundation` was used for local dependency/build verification; the source and lockfile remain here. No shared node_modules folder is required.

## Next milestone

The native Google SDK adapter and durable spending guards are implemented; see [NATIVE-AI.md](NATIVE-AI.md) for local configuration and explicit evaluation commands. Real inference remains disabled by default. Next: authorized live text quality/cost evaluation, then verified WhatsApp ingress/delivery through this runtime.

Local AI browser smoke now passes with five products and ₹914 review (728 tokens); 24 tests pass. Open http://localhost:3017/native-test and click New AI test. Wait 15 seconds between AI messages, max three/minute and 100/day. Default demo preserved; WhatsApp not connected. See NATIVE-AI.md.

The native test page now uses a WhatsApp-style conversation and a separate 30-product image demo. Say hello, then try “I want screw boxes plus some paint”, or browse a category to see photos in one message. Choices/quantity require confirmation. Test details show hypothetical owner message costs; no WhatsApp messages are delivered. See WHATSAPP-EXPERIENCE.md.
