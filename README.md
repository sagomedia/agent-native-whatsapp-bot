# Agent-native WhatsApp bot

For daily development and WhatsApp testing, start with [LOCAL-DEVELOPMENT.md](LOCAL-DEVELOPMENT.md). To continue with another coding agent, read [AGENT-HANDOFF.md](AGENT-HANDOFF.md), [WORKING-PREFERENCES.md](WORKING-PREFERENCES.md) and [CONTRIBUTING.md](CONTRIBUTING.md). [DEVICE-SETUP.md](DEVICE-SETUP.md) also preserves dated recovery instructions; use the current handoff to choose the source.

Private repository: [sagomedia/agent-native-whatsapp-bot](https://github.com/sagomedia/agent-native-whatsapp-bot).

Status: the source includes the retail runtime, catalog hierarchy, multimodal input, WhatsApp channel and protected owner dashboard. The customer ordering release adds unknown-item estimates, owner quotes, a manually verified ₹10 UPI advance and post-order amendments. See the [deployment handoff](03-Output/customer-ordering-finish/RELEASE-REPORT.md) for the recorded deployed checkpoint and remaining owner acceptance. A subsequent [voice-processing repair](03-Output/customer-ordering-finish/AUDIO-INCIDENT.md) is also included in this branch; its verification and deployment status are separate from that earlier handoff. Started 2 October 2026.

Build a retail assistant that interprets whole customer requests and proposes typed business actions. Application services own identity, catalog facts, drafts, order confirmation, staff approval and payment truth.

## Workspace

- `01-Input/plan.md`: earlier one-shop ordering blueprint, retained for context.
- `01-Input/starter-vision/`: original starter ZIP and extracted reference documents, preserved unchanged.
- `01-Input/ksmc-demo/source/`: preserved 30-product pack; normalized data is under the build’s `resources/catalog/ksmc-demo/`.
- `VISION.md`: adopted starting direction, provenance and provisional decisions.
- `02-Build/shopbot-ai/`: application source and local setup.
- `03-Output/`: verification evidence and experiment results.

The starting documents describe intended features. Consult `02-Build/shopbot-ai/STATUS.md` for actual implementation status. Embedded agent prompts and historical claims in input documents are reference content, not authorization to deploy, charge money or contact customers.

Local Git history and rollback/export: `GIT-WORKFLOW.md`. Catalog and voice design: `02-Build/shopbot-ai/CATALOG-DISCOVERY.md`.

## Prepared checkout and daily workflow

Large searches use an agent-authored visual narrowing strategy over real catalog attributes. The agent chooses the useful order for that request; group taps filter inventory without selecting the example product or changing purchase count. Nine choices plus continuation fit a carousel, and missing metadata falls back to paged real products. See [dynamic discovery verification](03-Output/dynamic-visual-discovery/README.md) and [catalog design](02-Build/shopbot-ai/CATALOG-DISCOVERY.md).

On the prepared computer, open `/home/gk-pc/projects/shopbot-inventory-dev`. The application is in `02-Build/shopbot-ai/`. Source is published on GitHub through PRs #89 and #90; [PR #91](https://github.com/sagomedia/agent-native-whatsapp-bot/pull/91) contains the voice-correction and actionable-clarification follow-up, documented in [verification notes](03-Output/voice-corrections/README.md). Do not use an older SMB/recovery copy as the development baseline.

Clear add/remove/change requests execute against current inventory and cart rows. Ambiguous changes ask about named items, with photos and current choices; a removal question can offer “remove all shown” for exactly those rows. Repeated named quantities set totals; a genuine increase needs separate source evidence. An unknown total gets an item-specific quantity question. Questions retain the pending action, and selecting a current choice resumes it without another model call.

```bash
cd /home/gk-pc/projects/shopbot-inventory-dev/02-Build/shopbot-ai
npm run local:db -- start
npm run build
npm run test:local
# When ready for an actual phone test:
npm run whatsapp:local
```

Wait for `LOCAL_ROUTE_READY`, then send a fresh message from the configured test phone to the same WhatsApp number. Open the [local dashboard](https://shopbot-local.sagoautomation.tech/owner) and sign in with the existing password. The [VPS dashboard](https://shopbot-preview.sagoautomation.tech/owner) always stays on the VPS. Ctrl+C restores the WhatsApp webhook to the VPS and disables the local addresses; `npm run whatsapp:restore` is the recovery command. Other senders are excluded during local test routing. Stop local mode before deploying.

The private `.env`, `.env.ai` and `.env.whatsapp` files are already configured here and ignored by Git. Local products/photos are a separate snapshot; orders, stock edits and test chats remain local. Git pulls do not copy credentials, refresh inventory or restore databases. `npm run dev` opens the offline preview at localhost:3018; it must be stopped before connected mode. Run `npm run dev:dashboard` separately for dashboard asset changes.

Normally: reproduce the problem, create a focused branch, fix the general inventory/semantic behavior, run mocked checks and appropriate metered fixtures, test on the owner's phone, push a PR, verify CI, then deploy an authorized release. A push or merge alone does not update the VPS. Do not add product-specific keyword branches as repairs.

To hand over in the same folder, give the next agent this context:

> Open /home/gk-pc/projects/shopbot-inventory-dev. Read AGENT-HANDOFF.md, WORKING-PREFERENCES.md, CONTRIBUTING.md, LOCAL-DEVELOPMENT.md and 03-Output/voice-corrections/README.md. Inspect git status and the current branch before changing anything. Continue the current voice-correction work without discarding another agent's edits. ShopBot uses semantic understanding grounded in current inventory; preserve counts, unrelated cart rows, genuine product photos and explicit submission. Verify current local/VPS routing before starting or stopping services. Keep secrets/private audio outside Git and distinguish synthetic tests from actual phone acceptance.

Use one writer in this checkout. Chat history and MCP/account permissions do not automatically transfer to another coding agent. See the handoff for architecture, deployment checkpoints, budget limits and remaining acceptance.

## Fresh-device mock quick start

Clone the repository onto a local disk, then start the mock environment:

```bash
git clone https://github.com/sagomedia/agent-native-whatsapp-bot.git
cd agent-native-whatsapp-bot/02-Build/shopbot-ai
cp .env.example .env
# Set your local database password in .env.
docker compose up --build -d
```

Open http://localhost:3017. The optional AI test page is at http://localhost:3017/native-test; provider configuration and explicit opt-in are described in [NATIVE-AI.md](02-Build/shopbot-ai/NATIVE-AI.md). Mock messages stay local. Deployment reports are historical evidence; a local source change does not update the connected VPS.

## Development and verification

`main` is the current published application baseline, including the consolidated ordering, catalog, WhatsApp recovery and owner-dashboard work. The [21 October branch cleanup](03-Output/branch-cleanup-20261021/README.md) records the retired branches and their preserved commits. Inspect current branches and open PRs for unfinished work; dated branch reports are historical.

Create a `codex/<change>` or `feature/<change>` branch from an up-to-date `main`, open a pull request, and retire the branch after its work is merged. Historical rollback points are retained as `checkpoint/*` tags. See [CONTRIBUTING.md](CONTRIBUTING.md) for the workflow and [GIT-WORKFLOW.md](GIT-WORKFLOW.md) for recovery. Merging source does not deploy it or complete owner/device acceptance.

The [GitHub Actions workflow](.github/workflows/project-checks.yml) runs the build, PostgreSQL integration tests and catalog checks on pushes and pull requests, with a disposable database and mocked AI providers. Check the current commit's [Actions result](https://github.com/sagomedia/agent-native-whatsapp-bot/actions) before merging. Earlier reports and the saved CI proposal describe historical permission restrictions; workflow publishing was authorized on 15 October 2026.

Source, reference documents, demo catalog fixtures and verification evidence are versioned. Credentials, local databases, customer uploads, dependencies and build outputs stay outside Git. This private source repository does not back up runtime database or media volumes.
