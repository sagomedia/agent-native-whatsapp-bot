# Testable release handoff — 15 October 2026

The local implementation is committed through `95083e07e6cc031cc5e2ad30eb5e25a7f4206545`. It is **not 100% live completion**. The full suite passed 505 checks, the catalog preparation suite passed four Python checks, and the staged-asset repair passed its focused regression and clean rebuild. The packaged Node 22.22.1 server and MCP server boot with production dependencies; a durable mock conversation and a restart with the service’s 128 MB heap limit preserve all six checked business ledgers. An actual dump/restore preserved 11 retained tables.

The source/build proof is in `033-release-evidence/build-manifest.json`; package metadata and checksum are in `033-release-evidence/release-summary.json`. The reviewed package is `/tmp/shopbot-verified-release/shopbot-vps-preview-f72c8fbfc04e.tar.gz` (71,698,378 bytes), SHA-256 `436fc7f95e73a5ad727a8947bda35cf7fd2de2d7bc02ce94e4da5eb64562ba69`.

The existing owner dashboard was extended. An isolated rehearsal is running at http://127.0.0.1:3042/owner?view=catalog with the supplied 100 products staged privately. It uses a disposable database and makes no AI, WhatsApp or payment calls. Merchant prices/stock/photo identity remain unverified. The old customer preview at port 3041 is also offline and is not the deployed bot.

Remaining gates:

- Name the payment provider/account; implement its real adapter, checkout flow and sandbox verification. The current payment foundation is disabled and tested only with a synthetic provider.
- Restore existing SSH access to the target VM. Both known usernames rejected the current local key; no key or access policy was changed. Deploy only after checking its existing flags, budgets, routes and backup/rollback state.
- The attempted source push was explicitly rejected: the OAuth App lacks `workflow` scope for `.github/workflows/project-checks.yml`. No branch/PR/hosted CI result was created. Do not retry through another credential surface to bypass this restriction; use an appropriately authorized credential or have the owner publish the reviewed branch.
- Connect the real Codex client, confirm the merchant catalog and Tamil terminology, then execute the actual voice/photo/phone pickup pilot. Local 505-pass evidence does not establish acoustic accuracy, real provider billing or live delivery.

The executable workflow is `02-Build/shopbot-ai/deploy/native/RELEASE-CHECKS.md`. Existing orders, media, unknown costs and the separate shared checkout were retained. No real customer message, charge, public recipient policy or deployment was changed.
