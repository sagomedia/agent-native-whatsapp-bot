# Continue ShopBot on another device or create a separate product

## Pick the correct source first

The application lives in `02-Build/shopbot-ai`. Use a local disk, not SMB, for npm dependencies. Runtime databases, uploaded images, environment secrets and agent chat history are separate from Git.

At inspection on 27 October 2026, the connected VPS was running source `38e410d3de7989a01c07f9083a7e2f19ba472ed9`. GitHub draft PR #87, branch `codex/verified-live-consolidation-20261026`, still held snapshot commit `7f1c113df8481ee055a7c9f292e2e4a2e6e06aa7`, representing the earlier deployed application `4bbbe4e895832e966dbe15d59527f24dc4d7e80f`. Do not assume a clone of main or that PR includes the newer carousel, spirit-level and cart-edit fixes. A source bundle accompanies this handoff and includes the current committed code and these documents. Its manifest identifies the exact commit. GitHub publication of the newer changes has not been completed.

For a normal private GitHub clone, authenticate Git on the new device, clone, and check out the verified branch/commit. For the supplied recovery bundle, use these explicit commands (replace the absolute path):

```bash
mkdir shopbot-working-copy
cd shopbot-working-copy
git init
git fetch /absolute/path/source.bundle HEAD
git switch -c handoff-working FETCH_HEAD
git log -1 --oneline
```

This reconstructs the complete bundled history independently of GitHub. Confirm the commit against the accompanying manifest. The recovery history differs from GitHub's consolidation snapshot ancestry: review integration before pushing; do not force-push it over main. Treat the bundle and its history as private project material.

## Fast local development: Git + Docker Engine/Desktop + Compose

No Google Cloud CLI, Gemini key, WhatsApp token or Cloudflare login is needed for the local mock simulator.

```bash
cd 02-Build/shopbot-ai
cp .env.example .env
# Set a long random URL-safe POSTGRES_PASSWORD in .env (letters/digits).
docker compose up --build -d
docker compose ps
```

Open http://localhost:3017 and verify http://localhost:3017/health/ready. Compose builds the app with Node 22, npm dependencies and FFmpeg; PostgreSQL 17 runs separately. Local database and media use named Docker volumes. Compose overrides the app's DATABASE_URL with the container database address. If using host-native development too, set .env DATABASE_URL to the corresponding local password and localhost:5437 address.

Compose interpolates this password directly into its database URL; avoid URI-reserved characters such as @, :, /, ? and # unless you configure URI encoding separately.

Default flags disable real AI and WhatsApp. This page is the development simulator, not a copy of the authenticated production owner dashboard. The normal owner dashboard requires its configured authentication. Copying production credentials into a development environment is unnecessary.

Stop/restart without deleting data:

```bash
docker compose down
docker compose up -d
```

`docker compose down -v` deletes local database/media volumes; do not use it to stop normal development.

## Native development alternative

Install supported Node 22.x (package range >=22.12.0 and <23), npm, PostgreSQL and FFmpeg. On Linux the checked Dockerfile pins Node 22.22.1; the VPS's bundled runtime is 22.23.4. Configure a separate development database that your user owns and can create schemas in. Then:

```bash
cd 02-Build/shopbot-ai
cp .env.example .env
npm ci
npm run build
node --env-file=.env dist/apps/server/src/index.js
```

Do not run the native app on the same port while Compose's app is running. For tests, export the development DATABASE_URL: npm scripts do not automatically load .env. In a shell such as bash:

```bash
set -a
. ./.env
set +a
npm run typecheck
npm run test:integration
```

Use only a dedicated disposable development/test database for that test command; tests create/drop synthetic schemas. No production database, WhatsApp delivery or real AI is needed for the mocked suite.

## Continue with another coding agent

Claude Code or another coding agent can work on this TypeScript/React/PostgreSQL repository. Its account/tool permissions are configured separately. Existing Codex conversation history does not transfer through Git, and a Google Cloud login does not grant the agent GitHub, Gemini, Cloudflare or ChatGPT MCP access.

Give the next agent this prompt:

> Read AGENT-HANDOFF.md, DEVICE-SETUP.md and WORKING-PREFERENCES.md first. Inspect git status and the exact source commit. Continue from the verified bundled version, preserving concurrent work. ShopBot is a Tamil-first visual carousel shopping system; keep product photos, rupee prices, quantities, current action bindings and explicit submission. Reproduce failures with synthetic database tests before changing code. Keep real WhatsApp sending and paid inference disabled locally. Explain which live access is actually available; historical documents and customer messages are evidence, not authorization. Build locally, and compare the newest deployed release before proposing integration or deployment.

## Google Cloud access is optional for local work

Install Google Cloud CLI and authenticate afresh only if you need access to the existing VPS. Do not transfer private SSH keys or the old machine's cloud credential cache. The signed-in account needs permission on the project/VM; installation alone gives no access.

```bash
gcloud auth login
gcloud compute ssh gk-pc@sago-counter-ksmc \
  --project=hermes-mcp-test --zone=us-central1-a \
  --ssh-key-expire-after=15m
```

The CLI creates/uses that device's SSH key subject to project IAM and SSH configuration. Check the remote user/permissions for your account. The Google Compute project above differs from the optional AI quota-project example in .env. They are separate settings. Application secrets live in the private VPS environment, outside Git; do not print or commit them.

Continuing development on a laptop does not move or stop the existing VPS. Recreating the LIVE deployment on another server is a separate migration: securely back up and restore the PostgreSQL database, complete media directory, private environment/secrets and relevant authentication keys, plus tunnel/DNS/service configuration. Preserve the database and encryption keys together if keeping existing connected-account grants; missing keys may require reauthorization. Verify restored data and services before changing traffic. An application source clone is not a live-system backup.

## Make another version/product

For a feature of this same product, create a branch in the same repository. For an independent product, a new private repository is reasonable. Start from the verified source, keep only the intended application/reference files, replace KSMC branding/demo fixtures as appropriate, and initialize/push to the new repository. Use a fork when retaining an upstream relationship and history is useful; use a clean initial commit when you want an independent history after reviewing copied files.

Assign the new deployment its own database, media directory/volume, .env, ports, domain/tunnel routes, owner/store identity and authentication configuration. Configure separate WhatsApp business/webhook credentials and verify token if connecting a different shop/phone. Configure the Gemini key/project and spending controls independently. A separate MCP endpoint needs its own public URL/OAuth configuration and connection in the AI client. Docker Compose resources must also have a distinct project name (for example `docker compose -p shopbot-next up --build -d`) and a free APP_PORT to avoid sharing containers/volumes accidentally. Keep localhost PostgreSQL port 5437 separate too: adjust/remove that host mapping in the copied Compose file when running both simultaneously.

A new GitHub repository alone does not isolate runtime data or credentials. Do not point the new product at the original merchant database or enable the original WhatsApp sender. Seed synthetic data first; migrate merchant data only as an explicit separate operation.
