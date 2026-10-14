# Agent-native WhatsApp bot

Private repository: [sagomedia/agent-native-whatsapp-bot](https://github.com/sagomedia/agent-native-whatsapp-bot).

Status: the source includes the retail runtime, catalog hierarchy, multimodal input, WhatsApp channel and protected owner dashboard. The 14 October local reconciliation separates product approval, missing-quantity checks and consent to the final bill. See [the reviewed implementation plan](03-Output/030-shopbot-reviewed-implementation-plan.md) and [local verification](03-Output/031-counter-flow-implementation.md). Started 2 October 2026.

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

## Quick start

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

`main` is the current application baseline. Create a `codex/<change>` or `feature/<change>` branch for further work and open a pull request. Historical rollback points are retained as `checkpoint/*` tags. See [CONTRIBUTING.md](CONTRIBUTING.md) for the workflow and [GIT-WORKFLOW.md](GIT-WORKFLOW.md) for recovery.

The current verification count and results are recorded in [local verification](03-Output/031-counter-flow-implementation.md). The [GitHub Actions workflow](.github/workflows/project-checks.yml) is now included in the working branch and supplies a disposable database with mocked AI providers. Its first hosted run is pending publication of the branch.

Source, reference documents, demo catalog fixtures and verification evidence are versioned. Credentials, local databases, customer uploads, dependencies and build outputs stay outside Git. This private source repository does not back up runtime database or media volumes.
