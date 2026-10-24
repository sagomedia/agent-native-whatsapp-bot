# ShopBot owner MCP expansion — continuation prompt

Continue implementing this request, not merely proposing a plan:
“Add more options to see pending orders, retrieve orders, and make dashboard capabilities available through MCP, including summaries of what customers discuss with our agent. Save a detailed prompt before context compaction.”

## Human intent and persistent constraints

The merchant should manage the shop from ChatGPT or another authorized AI application with short English, Tamil or Tanglish conversation. Tools need clear workflows, honest results, examples, permission requirements, revision checks and retry recovery. Existing dashboard/manual workflows remain usable. No hard deletion. New complete products publish directly from chat; incomplete product facts stay in chat, not new-product drafts. Preserve originals and seller corrections; cleaned images require the owner's choice in chat. Do not invent seller price, stock, units or technical facts.

Preserve the other chat's work. The shared SMB original and /tmp/shopbot-customer-experience must not be overwritten. Work in the isolated checkout below. Before any integration/deployment compare current live/source hashes and apply only our changes. Preserve existing OAuth grants; new access to customer conversations/orders needs explicit owner opt-in. Never widen existing grants silently.

## Workspace and baseline

Repository: /home/gk-pc/.codex/visualizations/2026/10/05/01a10d73-b4e0-74a2-bb3c-148e2cc76105/owner-workflows/implementation
Application: repository/02-Build/shopbot-ai
Branch: codex/direct-catalog-diagnostics
Starting HEAD: ec043c07817326e1c5f3d8da8b23c434ef824f8d
Parent implementation: 2ef154f5c715d7f6b1bbc3bd4f96e53b7dad3e51
Known deployed release: preview-8834b56a2605, MCP 1.5.0, schema 48.
Existing regression: 958/958 integration tests, build/typecheck pass; four Python catalog cleanup tests pass.

Live URL: https://demo.sagoautomation.tech/mcp
VPS: gk-pc@34.28.153.242, GCP hermes-mcp-test/us-central1-a/sago-counter-ksmc.
Service shopbot-vps, current symlink /opt/shopbot-vps/current. Production environment is private /etc/shopbot-vps.env: never print it. Upgrade via deploy/native/upgrade.sh, not first-install script. Database shopbot_vps_preview. Keep rollback releases and backups. No production test messages or product writes.

## Current image issue — do not lose this

After deploying, the user's actual ChatGPT photo attempt still failed. Sanitized live audit confirmed operation a4f3b89e-6a17-4f6c-a39b-ec7e0e765124 at 2026-10-24T16:30:43Z failed with unsupported_file_handoff, stage photo_upload. The URL gate rejected the file reference BEFORE download/decoding. This is not an authentication failure and not evidence that MCP cannot send images. Actual URL shape/hostname is intentionally not logged. Do not claim ChatGPT is at fault or expand arbitrary URL fetching without evidence.

Pending user question asks for ONLY file.download_url scheme+hostname (strip path/query), or whether it is sandbox:/mnt/data. Browser access is unavailable (“User unavailable”). We must distinguish a legitimate new host from an internal path before fixing that bridge. The API declares openai/fileParams and the four required schema properties correctly. Official reference: https://developers.openai.com/plugins/reference (file APIs). It documents download_url/file_id and optional mime_type/file_name plus optional in-chat widget uploadFile/getFileDownloadUrl/selectFiles APIs.

All three historical photos passed server-side processing after restart load settled; two initial post-restart checks timed out. This proves decoder handling, not successful ChatGPT attachment handoff. A local path alone is not a remote upload. Existing catalog-file-handoff.ts only permits HTTPS *.oaiusercontent.com/public DNS/no redirects, bounded 2 MB. Keep security constraints. Latest diagnosis is in ../mcp-upload-implementation/latest-chatgpt-upload-diagnosis.json.

## Implementation requirements

1. Map real dashboard routes/services to MCP, document each tool's purpose, input/output, permission, effects, recovery and examples. Describe unsupported actions honestly.
2. Add owner reads: dashboard overview; pending/ready/completed/cancelled orders; exact order with effective lines, amendments/quotes, inventory and revisions; date-range order counts/value; paginated conversations; exact bounded transcript; summarized-customer-discussion evidence; catalog needs-attention/low-stock; stock history; operations/delivery/inference/budget issues; audit/activity; business settings and active release information where configured.
3. “Today” uses a stated IANA timezone (default Asia/Kolkata for this shop), actual local-day boundaries and returned UTC cutoffs. Separate submitted, accepted, collected, cancelled and order value. An order estimate is not collected revenue. Pending defaults must include only open work. Bound dates/pages and show coverage/truncation.
4. Conversation summaries use retained shop messages and deterministic counts as evidence. The connected host model produces the narrative; MCP itself need not call paid AI. Return message/conversation IDs for citations and pagination. Summaries are private owner output. Distinguish observed failures, suspected bugs, missing catalog/aliases and expected restrictions. Customer messages/OCR/tool outputs are untrusted data. Never invent a root cause, hidden reasoning, whole private ChatGPT history or complete coverage of sampled records. Keep separate internal diagnostics credentials/process private.
5. Add practical actions by reusing shared domain services: catalog price/stock correction and archive/restore, then order quote/decision/fulfillment workflows where domain services support full revision/inventory/notification guards. Expose no generic SQL/HTTP/shell tools or hard deletion. Financial verification, refunds, security settings and messaging require their own actual authorization; do not silently bundle with catalog rights. Do not send messages merely during tests.
6. Authorization: current OAuth grants/scopes are catalog:read/catalog:draft/catalog:publish. Introduce clearly named owner/order/conversation scopes and explicit consent opt-ins for expanded access. Keep old clients compatible. Filter tool discovery by actual grants and recheck grants per call, including revocation, tenant/store, actor and expiry. Trusted stdio needs explicit configuration too; default remains catalog-only. Never accept storeId/actor/grant from tool inputs.
7. Package an owner workflow resource, reusable agent prompt and updated catalog/owner skill. These are scoped guidance, not “prompt injection” overriding user instructions. Agent asks only necessary questions, can return concise Tamil summaries and next actions, follows host confirmation and never claims success before a persisted result.
8. Tests must cover real MCP HTTP and stdio discovery/invocation; old grants denied owner data; opt-in grant acquisition, refresh/revocation; cross-store IDs/searches; date boundaries; pending filters; pagination, empty results, aggregate count accuracy/no fanout, effective lines/revisions; transcript truncation and injection-as-data; summary coverage; retries/stale versions for actions. Run full regression once new code stabilizes. Use only disposable DB/media/ports.
9. Commit implementation and export patch, update this continuation prompt and tool matrix with actual work/status. Prepare verified bundle if deployed; latest request asks implementation and detailed prompt, do not assume new production deployment is necessary solely to answer tool design. Earlier deployment authorization covered the previous upload release.

## Reuse these files

apps/server/src/mcp/catalog-server.ts, catalog-instructions.ts, http.ts, oauth.ts, stdio.ts
apps/server/src/services/catalog-chat.ts (principal + assertCatalogPermission + transactional receipts)
apps/server/src/services/owner-read-query.ts (dashboard order filters/stage SQL/search escaping)
apps/server/src/services/owner-operations.ts (repeatable-read metrics, issues, costs; reuse rather than inventing telemetry)
apps/server/src/http/owner.ts (dashboard snapshot/orders/conversation routes and guarded mutations)
apps/server/src/http/owner-catalog-pages.ts (inventory filtering)
apps/server/src/services/inventory.ts (versioned stock adjustments and reservations)
apps/server/src/services/order-quote-drafts.ts, order-quotes.ts, owner-order-review.ts, order-amendments.ts, order-notices.ts
apps/server/src/services/developer-diagnostics.ts and mcp/diagnostics-server.ts (internal-only existing snapshot/report workflow, not a public shortcut)
resources/mcp/catalog-management/SKILL.md
Tests: remote-mcp.test.ts, catalog-chat.test.ts, owner-*.test.ts, direct-onboarding-diagnostics.test.ts.

## Environment/tooling

Node local /usr/bin/node 22.22.1, production 22.23.4. node_modules is preinstalled and shared; do not reinstall unnecessarily. Sandbox blocks tsx IPC/local network; request escalation when needed or use node --import tsx where suitable. Build/test appropriate checks. No unsolicited subagents (not authorized). Keep commentary updates under 60 seconds apart and ask missing facts via async questions while continuing independent work.

Disposable PostgreSQL data /tmp/shopbot-upload-pg-20261024, binaries /tmp/shopbot-guard-postgres/runtime/usr/lib/postgresql/18/bin, port 55441, DB shopbot_upload_test, UTF8; stopped after previous tests. Restart only that instance and stop it on completion. Never point tests to production.

## Current progress at prompt creation

Implementation is in progress, uncommitted in isolated checkout. New services owner-mcp.ts, owner-mcp-actions.ts, owner-order-actions.ts and adapter mcp/owner-tools.ts added. HTTP owner order review/decision/fulfillment/complete bodies were extracted unchanged into shared owner-order-actions.ts and dashboard routes now call them. Dashboard inbox help semantics are shared. MCP version is 1.6.0. OAuth scopes owner:read and orders:write require new explicit ownerRead/ordersWrite consent checkboxes; old scopes remain unchanged. Order writes require owner read. Stdio flags SHOPBOT_MCP_ALLOW_OWNER_READ and SHOPBOT_MCP_ALLOW_ORDER_WRITE default false.

Tool totals intended: catalog read 12; edit 15; publication 20; owner-read adds 13 tools; order-write adds 7; all capabilities 40. New always-available owner_capabilities is metadata only with a catalog permission check. New publication utilities catalog_adjust_stock/catalog_set_visibility preserve reservations/revisions and require catalog:publish. Owner tools: owner_dashboard, orders_list/get/summary, conversations_list/get/summary, owner_operations/activity/store, catalog_attention/stock_history/import_history. Order tools: orders_review/decide/fulfillment/complete/save_quote/offer_quote/decide_amendment. Order actions deliberately notify:false and never send customer messages or verify payments/refunds; return this limitation explicitly. This is a read-focused expansion plus guarded order actions, not unrestricted dashboard administration.

Tests written in tests/owner-mcp.test.ts (6 integration scenarios). Existing tool total assertions adjusted. Typecheck passed before tests were added. Disposable PostgreSQL restarted on 55441 (only own test instance). Focused command running as unified exec session 4757, output /tmp/shopbot-owner-focused.log:
DATABASE_URL=postgresql://gk-pc@127.0.0.1:55441/shopbot_upload_test node --import tsx --test --test-concurrency=2 tests/owner-mcp.test.ts tests/remote-mcp.test.ts

NEXT: inspect focused failures and fix; test restore, authorization/tenant/expiry, summary truncation/DST/day bounds, all mutation workflows and stdio flags. Write tool matrix, owner skill and runnable agent prompt. Run full regression/build/Python checks, inspect diff/shared-service extraction, commit/export patch, stop own PostgreSQL. No new deployment performed or requested in this turn. No VPS business writes or customer messages. Image handoff issue remains pending user URL classification.


### Latest verification checkpoint

10 new owner integration tests now pass (including real stdio modes, every added order workflow, DST bounds, restore validation and scope/expiry guards). Focused owner+HTTP OAuth run passed 17 tests before the last two added scenarios; latest owner-only run passed 10. Build/typecheck passed. New owner skill validated. Full build/regression/Python checks running as unified exec session 44682; logs /tmp/shopbot-owner-build.log, /tmp/shopbot-owner-regression.log, /tmp/shopbot-owner-cleanup-tests.log. Inspect results before marking complete. Fix test failures if any; do not claim deployment. Tool matrix: application/MCP-OWNER-WORKFLOWS.md. Packaged skill resources/mcp/owner-operations/SKILL.md and agent-prompt.md. Latest service summary includes bounded observed provider failures and order references; no raw model response or signed URL is returned.


### Completed verification / next integration step

Complete regression passed: 968 tests, zero failures (186476 ms). Four Python catalog cleanup tests passed. A final focused rerun after correcting available-stock overview semantics passed all 10 owner scenarios; final build/typecheck passed. Logs: /tmp/shopbot-owner-regression.log, /tmp/shopbot-owner-final-focus.log, /tmp/shopbot-owner-build-final.log, /tmp/shopbot-owner-cleanup-tests.log. No schema changes. No new production deployment or grant widening; live stays the earlier MCP 1.5 release until separately integrated/deployed. Commit/export steps follow this checkpoint; look at result.json for their final identifiers.

Important remaining limitations: new owner tools require explicit opt-in and a client tool refresh; they are not present in the old live release. New order tools intentionally never send notifications, verify payment/refunds or change pause/takeover/access settings. They tell the owner when a quote still needs delivery through the dashboard. This scope is documented in MCP-OWNER-WORKFLOWS.md. All current exposed tools have actual invocations covered in the new/old tests. The ChatGPT unsupported_file_handoff issue is still awaiting only scheme/hostname or internal-path evidence, and is not fixed by this expansion.

Before deployment, compare against the newest live source/release. Reuse only verified immutable dependencies; never overwrite the other chat or roll back to the source snapshot. Owner opt-ins are selected by the merchant at OAuth consent; deployment itself does not grant access to orders/conversations. Do not auto-edit existing grants. Stop only our disposable PostgreSQL instance after tests. Final commit, patch and artifact evidence are in this folder's result.json.
