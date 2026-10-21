# Agent-native WhatsApp bot

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

`main` is the current published application baseline, including the consolidated ordering, catalog, WhatsApp recovery and owner-dashboard work. The [21 October branch cleanup](03-Output/branch-cleanup-20261021/README.md) records the retired branches and their preserved commits. One active dashboard branch remains for unfinished inventory work.

Create a `codex/<change>` or `feature/<change>` branch from an up-to-date `main`, open a pull request, and retire the branch after its work is merged. Historical rollback points are retained as `checkpoint/*` tags. See [CONTRIBUTING.md](CONTRIBUTING.md) for the workflow and [GIT-WORKFLOW.md](GIT-WORKFLOW.md) for recovery. Merging source does not deploy it or complete owner/device acceptance.

The [GitHub Actions workflow](.github/workflows/project-checks.yml) runs the build, PostgreSQL integration tests and catalog checks on pushes and pull requests, with a disposable database and mocked AI providers. Check the current commit's [Actions result](https://github.com/sagomedia/agent-native-whatsapp-bot/actions) before merging. Earlier reports and the saved CI proposal describe historical permission restrictions; workflow publishing was authorized on 15 October 2026.

Source, reference documents, demo catalog fixtures and verification evidence are versioned. Credentials, local databases, customer uploads, dependencies and build outputs stay outside Git. This private source repository does not back up runtime database or media volumes.
