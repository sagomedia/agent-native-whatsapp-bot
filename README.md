# Agent-native WhatsApp bot

Private repository: [sagomedia/agent-native-whatsapp-bot](https://github.com/sagomedia/agent-native-whatsapp-bot).

Status: the source includes the retail runtime, catalog hierarchy, multimodal input, WhatsApp channel and protected owner dashboard. Local reconciliation separates product approval, quantity checks and final bill consent. The 15 October P2 package adds actual-request admission, persistent turn deadlines, rate-expiry handling and delivery-cost reconciliation. See [the reviewed implementation plan](03-Output/030-shopbot-reviewed-implementation-plan.md), [counter-flow verification](03-Output/031-counter-flow-implementation.md) and [P2 verification](03-Output/032-p2-cost-and-admission.md). These local packages have not been deployed. Started 2 October 2026.

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

The current verification count and results are recorded in [P2 verification](03-Output/032-p2-cost-and-admission.md). The [GitHub Actions workflow](.github/workflows/project-checks.yml) is included in the working branch and supplies a disposable database with mocked AI providers. Its first hosted run is pending publication of the branch.

Source, reference documents, demo catalog fixtures and verification evidence are versioned. Credentials, local databases, customer uploads, dependencies and build outputs stay outside Git. This private source repository does not back up runtime database or media volumes.
