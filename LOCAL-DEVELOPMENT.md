# Run ShopBot locally with WhatsApp

Use the prepared checkout on local disk. The local application uses its own PostgreSQL database and inventory snapshot. It connects to Gemini and receives messages for the shop’s existing WhatsApp number through the VPS tunnel.

## Start the connected session

From the prepared computer, run:

```bash
cd /home/gk-pc/projects/shopbot-inventory-dev
npm run whatsapp:local
```

The launcher starts the Docker Compose PostgreSQL service, checks the private profile and local catalog, verifies Gemini and WhatsApp access, builds the application, starts the backend on loopback port 3018, and opens the SSH reverse tunnel. Wait for `LOCAL_ROUTE_READY`. If an existing session already owns the port, use it or stop it cleanly before starting another.

1. Sign in to the [local owner dashboard](https://shopbot-local.sagoautomation.tech/owner).
2. Send a fresh message to the connected number from a WhatsApp account. Choose an actual product and check that the same conversation and order appear in the local dashboard. Buttons from a VPS conversation refer to that VPS conversation.
3. Press Ctrl+C in the launcher terminal when finished. The VPS route guard restores the original webhook after the tunnel closes and takes the local-only hosts offline. If the launcher exits unexpectedly, run `npm run whatsapp:restore`. The remote watchdog also restores routing on tunnel loss or session expiry (six hours).

The VPS dashboard and its media/MCP endpoints continue serving VPS data throughout. The shared webhook temporarily forwards to the local backend, where any valid WhatsApp sender can start a conversation. Messages and orders received during that session are stored in the local database. Local media uses the dedicated local channel host. Each dashboard has its own hostname-bound sign-in. Finish the local session before a VPS deployment or ingress change. [VPS owner dashboard](https://shopbot-preview.sagoautomation.tech/owner)

## Prepare another computer

- Use a local-disk clone of the [private repository](https://github.com/sagomedia/agent-native-whatsapp-bot). From the checkout root, install dependencies with `npm ci` using Node 22.12+ within 22.x. Install Docker Engine or Desktop with Compose, FFmpeg, and the authenticated Google Cloud CLI with authorized SSH access to the existing VPS.
- Set up private, mode-0600 `.env`, `.env.ai` and `.env.whatsapp` in the app directory using their corresponding examples. In the authorized local Gemini profile, set the approved key, `ALLOW_PAID_INFERENCE=true` and the authorized cumulative cap in `AI_BUDGET_USD`. The connected WhatsApp profile accepts a positive cap up to US$5. In the WhatsApp profile, configure `WHATSAPP_AUDIENCE=public`, the authorized Meta business sender, owner login and tunnel identity. Keep the two local hostnames in the WhatsApp example. The VPS already runs the tunnel connector and the separate-domain routing helper.
- Configure `POSTGRES_USER=shopbot_local` and a private `POSTGRES_PASSWORD` matching the credentials in the connection URLs. Use the Compose database on `127.0.0.1:55441`, with `shopbot_dev` for `DATABASE_URL` and `shopbot_local_test` for `TEST_DATABASE_URL`. URL-encode credentials in connection URLs when needed.
- Supply the approved inventory-only snapshot and matching media in their private local locations. Set `LOCAL_CATALOG_SNAPSHOT` before first launch so the launcher can seed the empty shop. It preserves the existing catalog on later starts. Use `npm run local:catalog` for an intentional refresh that replaces local catalog, stock and price edits. Resolve existing test reservations or use a fresh development database before refreshing. Pulling code leaves shop data in place.

Local WhatsApp and CLI evaluation use separate cumulative ledgers. For an existing store, an authorized cap change must also update its stored limit while preserving committed spending and outstanding holds. Starting another chat or restarting the process preserves the ledger. Keep private credentials, retained audio, logs and customer data outside Git.

## Diagnose a connection

`npm run whatsapp:check` checks the connected settings, local catalog, Gemini model access and the WhatsApp sender without switching the webhook. Use it with the database available. Inspect the private `data/logs/local-whatsapp.log` for backend errors. The shared webhook reaches the local store only after the readiness marker. A ready server alone does not establish that a message arrived on the phone.

## Verify a source change

With the local database available, run `npm run build`, `npm run test:local` and `python3 -m unittest discover -s scripts -p 'test_catalog_cleanup.py'`. The integration suite uses temporary schemas in the disposable UTF-8 `_test` database. Hosted CI provisions its own database.

For authorized metered evaluation, use `npm run eval:local -- --preflight` then `npm run eval:local -- --fixtures tests/fixtures/local-shopping.json`. The correction fixture `tests/fixtures/local-voice-corrections.json` checks replacements, known counts and negation. The evaluator reads synthetic or separately authorized media, uses a disposable store and writes its report under ignored `artifacts/unified-evaluation/`. Sending a retained private customer recording to the provider requires authorization for that recording. Check native cards, delivery and actual voice quality on the authorized phone.
