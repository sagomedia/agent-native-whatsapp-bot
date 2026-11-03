# ShopBot coding-agent handoff — 3 November 2026

Read this file, WORKING-PREFERENCES.md, CONTRIBUTING.md and LOCAL-DEVELOPMENT.md before editing. Inspect `git status`, the current branch and recent commits. This file is durable project context; chat history is not copied between agents.

## Correct working folder and source

Prepared checkout on this computer: `/home/gk-pc/projects/shopbot-inventory-dev`.

Application: `/home/gk-pc/projects/shopbot-inventory-dev/02-Build/shopbot-ai`.

Private GitHub repository: https://github.com/sagomedia/agent-native-whatsapp-bot.

Published baseline before this investigation: main `10a44dfb755d5f41748524b9dc936446851e36d8`, merging PR #90 after PR #89. The earlier unpublished-source warnings in dated recovery reports are historical. Do not replace this checkout with an older SMB folder or recovery bundle.

Current review branch: `codex/voice-corrections-and-handoff` (local repairs and documentation implemented); see `03-Output/voice-corrections/README.md` for scope, evidence and verification. Keep one writer for this branch. Another agent can use this exact folder and read these files, but should not switch branches, pull over uncommitted edits or change shared files concurrently. Check with the current operator before taking over a running local session. A separate worktree provides independent files, but does not automatically isolate ports, databases or WhatsApp routing.

## Product and decision boundaries

ShopBot is a Tamil/Tanglish visual shopping assistant backed by current inventory, potentially thousands of products. Understand meaning, search inventory, show genuine product photographs/names/prices, preserve the full requested list, let the customer choose, then review and explicitly submit. Missing counts, prices and identities remain unknown. Photos/cards, product approval, order submission and owner acceptance are separate steps.

Use typed semantic decisions for add/remove/change, grounded in exact current cart IDs and observed inventory. Do not introduce product keyword branches, fixed category menus or growing command-verb allowlists. Keep source speech/text separate from canonical queries and search keywords. Inventory aliases and family labels can be incorrect: compare actual product names and specifications. A text instruction card represents an unresolved request; do not fabricate a photo to hide it.

Services enforce versions, idempotency, permissions, negation, measurement/count separation, selling basis, arithmetic and explicit consent. Button actions reuse saved state without extra inference. Preserve unrelated cart rows and known counts during identity corrections.

The approved clarification follow-up asks a concrete decision about actual items and actions. Do not echo the transcript or ask generic permission instead of executing a clear request. Repeating a named quantity means its desired total; increasing it needs separate `additionalEvidence`, not merely a count labelled additional. An unchanged item remains represented in a multi-item request. An unknown total uses a typed `quantityQuestion`, bound to that exact row, and a bare number resumes it. Ambiguous single removals may offer all of the displayed candidates through `cartGroupAnswer`/`resolve_cart_group`; that scope never expands to unrelated rows or the whole cart. Current versions, displayed actions and negation remain enforced.

## Architecture and files to inspect

The app uses TypeScript/Fastify, React/Vite and PostgreSQL. Paths below are relative to the application folder.

- `apps/server/src/runtime/conversation.ts`: metered recognition, understanding, bounded repair, inventory grounding and transaction flow.
- `apps/server/src/adapters/google-speech-recognizer.ts`: dedicated Gemini 3.5 Transcribe, audio-only verbatim recognition. The current repair adds saved Tamil/English language hints; no cart/catalog/history is sent to ASR, and returned text is not forcibly translated.
- `apps/server/src/adapters/google-interpreter.ts` and `turn-understanding.ts`: Gemini 3.5 Flash Lite, strict semantic contract, evidence checks and compiler. Product-identity corrections should use one `replace` edit with the full correction span, preserving the current row/count. A rejected plan's single repair receives bounded fresh inventory facts so it can also select observed products. Exact grounding target kinds/keys are supplied to avoid converting a replacement patch into a new item.
- `packages/contracts/understanding.ts` and `model-policy.ts`: typed contract and versioned prompt identity.
- `apps/server/src/services/cart-clarification.ts`: questions generated from typed actions and actual current rows; exact offered-removal scope. `visual-ordering.ts` preserves those questions and attaches scoped choices to real product cards. `language.ts` uses typed quantity errors instead of an English-message keyword match.
- `apps/server/src/services/inventory-grounding.ts`, `inventory-edit-targets.ts`, `catalog-discovery.ts`, `quantity-evidence.ts`, `tools.ts`: actual catalog identities, target binding and deterministic execution.
- `tests/actionable-clarification.test.ts`, `crud-language.test.ts`, `google-speech-recognizer.test.ts`, `unified-understanding.test.ts`, `voice-cart-crud.test.ts`: key regressions. The actionable tests cover the reported unfinished pipe/Allen-key cart, a different grocery inventory, real photos, totals, group answers, forged/stale callbacks and negation, without live provider calls.

Recognition and understanding use separate durable attempts. Every paid call requires a budget reservation; do not bypass accounting, reset cumulative allowances, hide retries or describe a rejected semantic turn as a successful evaluation. Search-only inventory patches preserve the original actions/count evidence. See LOCAL-DEVELOPMENT.md for fixture syntax and evaluator reports.

## Current investigation

The owner reported a Tamil correction from cutting blade to wire-cutting plier being rejected, and Tamil speech saved in Hindi/other scripts. Read-only inventory MCP confirmed the VPS conversation; retained provider diagnostics showed that the two semantic attempts emitted an incomplete removal fragment plus a separate new item instead of one replacement. ASR had retained Tamil for that correction. A separate local pipe/Allen-key voice note was saved as Hindi because dedicated transcription used automatic language detection with no saved-language hint.

Offline replay also found full catalog specifications leaking into the bounded customer-filter plan: products with more than six metadata entries could fail on preview refresh and roll back the correction. Catalog peer constraints now stay internal; returned plans preserve the customer filters. Several semantically selected products also remain choices instead of inheriting the first alias match's unrequested size/pack metadata. A regression covers repeated discovery/preview of such products.

The subsequent pipe/Allen-key report had a faithful Tamil transcript but a semantic plan that omitted the Allen key and treated “one pipe” as an extra unit against an unknown previous count. Its quantity error was then rendered as a selling-unit warning by a broad error-message regex. The follow-up enforces separate additional evidence, retries with every named item retained, refreshes unresolved identities against inventory, binds unknown totals to focused questions, and uses typed error meanings. Target-question rendering no longer replaces action-specific copy with a generic question. Rejected evidence remains a no-op; named choices require a fresh customer selection.

This stage repairs the local source and documentation. Do not deploy it to the VPS merely because the local build passes. Keep owner/device acceptance open in issue #88. Private recordings and raw diagnostics remain ignored/outside Git. Replaying the specific retained local recording to Gemini was blocked by automatic approval review pending explicit user permission; do not replay it without that permission. Synthetic tests and the existing authorized local allowance remain available.

## Local setup and normal commands

Node 22, npm and FFmpeg are installed. Native PostgreSQL 18 uses loopback port 55440. Separate databases are `shopbot_dev` and disposable `shopbot_local_test`. The local inventory snapshot contains 343 products and their 312 referenced photos; it excludes VPS customer/order history. Stock and prices are snapshots, not live availability. Pulling code does not refresh them.

Private `.env`, `.env.ai`, `.env.whatsapp` already exist in the app directory, mode 0600 and Git-ignored. They contain the approved reused Gemini/WhatsApp credentials and local database configuration. Do not print, paste, commit or overwrite their values. They are not in GitHub and are not transferred to another computer by cloning.

```bash
cd /home/gk-pc/projects/shopbot-inventory-dev/02-Build/shopbot-ai
npm run local:db -- start
npm run build
npm run test:local
python3 -m unittest discover -s scripts -p test_catalog_cleanup.py
```

For an offline preview run `npm run dev` and open http://localhost:3018. For dashboard asset edits use `npm run dev:dashboard` in a second terminal. The mock preview does not prove real AI or WhatsApp behavior.

Metered evaluation, without WhatsApp transport:

```bash
npm run eval:local -- --preflight
npm run eval:local -- --fixtures tests/fixtures/local-shopping.json
```

Local CLI evaluation and the local connected channel each retain their own cumulative US$0.50 ceiling. Restarting does not reset either ledger. Use synthetic fixtures unless the user has authorized sending specific retained customer audio to the provider. Reports live under ignored `artifacts/`. Photo-sensitive fixtures use `minimumPhotoCandidates`; names/counts alone cannot pass. Small cases can set `EVALUATION_MAX_OUTPUT_TOKENS=2048`, which lowers the real API output limit and its reservation together without increasing/resetting the cumulative allowance. The conservative full-context reservation may otherwise block before nominal spend reaches the ceiling.

## Same-number WhatsApp and full dashboard

```bash
npm run whatsapp:check
npm run whatsapp:local
```

Wait for `LOCAL_ROUTE_READY` before the owner tests. The ordinary `npm run dev` must be stopped first because both use port 3018. The one configured test recipient can send fresh messages to the same number. **Local dashboard:** https://shopbot-local.sagoautomation.tech/owner. **VPS dashboard:** https://shopbot-preview.sagoautomation.tech/owner, which always stays on the VPS. Both use the existing password but independent hostname-bound sessions. Local catalog edits/orders remain local. Other senders are excluded by the test-recipient list while local mode is active.

Do not stop the VPS machine or its ShopBot service. The helper uses an SSH reverse tunnel and a temporary Cloudflare routing override. The separate local dashboard/channel hosts point to the existing VPS tunnel and then local loopback:3018; do not add another connector for that tunnel on this computer. `shopbot-local-api.sagoautomation.tech` serves local media. Only the existing Meta `/webhook` route temporarily forwards to local, with its origin Host rewritten to the local channel host. The older helper switched the VPS dashboard too; the new launcher requires remote `check-separated` support and refuses the old shared-domain profile. See `03-Output/local-domain-separation/README.md` for verification and recovery.

Production MCP and existing media routes remain on the VPS, so inventory MCP conversation reads refer to VPS data, not local test chats. Inspect the local database/dashboard and `data/logs/local-whatsapp.log` for local tests. No agent should send customer messages to verify delivery without explicit authorization.

Ctrl+C restores the VPS webhook and takes the local domains offline; they never fall back to VPS data. On a failure run `npm run whatsapp:restore`; the remote watchdog also restores after tunnel/backend loss. Sessions expire after six hours. Do not deploy or change Cloudflare ingress while local routing is active. Routing/process state is transient: verify current readiness instead of trusting a historical handoff statement.

## VPS and publication

VM `sago-counter-ksmc`, project `hermes-mcp-test`, zone `us-central1-a`; app service `shopbot-vps`, relay `cloudflared`. Current code symlink `/opt/shopbot-vps/current`, private env `/etc/shopbot-vps.env`, media `/var/lib/shopbot-vps/media`, database `shopbot_vps_preview`. Public MCP is https://demo.sagoautomation.tech/mcp.

Last verified VPS release before this stage: `preview-ac60c1f5cc5c`, source `e5ce49f1e5c8333ee6658cbd38985dcb83da9c0e`, prompt `2026-11-02.inventory-grounding.3`. PR #90's final evaluator-unit correction did not alter runtime code. Recheck the running release manifest when deciding what is deployed. The private pre-upgrade backup is `/var/backups/shopbot-migration/owner-20261102T164242Z`.

Build/test/package locally; never compile on this small VPS. A GitHub push/merge does not deploy. Follow CONTRIBUTING.md: focused commits, a PR, local checks, hosted CI before merging, tracked owner acceptance. Preserve live catalog/photos/customers/orders. Confirm the running release, health and content after an explicitly authorized deployment. Do not alter live records to reproduce a failure.
