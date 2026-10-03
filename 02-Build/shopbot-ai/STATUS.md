# Actual implementation status

Updated 2 October 2026.

## Completed: local foundation and reusable agent tool core

The local app/PostgreSQL foundation now exposes six customer tools through shared services: search_products, get_draft, apply_draft_changes, preview_order, submit_order_request and get_order_status. The simulator is a test channel over those services. The retail core contains no hardware fixture identities and was also exercised with a separate grocery store, including fractional quantities.

Implemented: strict operation batches, persistent resolved/unresolved lines, targeted candidate/quantity clarification, compound corrections, read-only price questions, integer-paise totals, current-fact review, trusted confirmation, immutable staff-pending requests, scoped customer access checks, idempotent receipts and transactional reply/effect commits. Conversation leases and a persisted mock-attempt ledger support bounded recovery. Known actions bypass interpretation.

The English mock interpreter is a deterministic test double. The HTTP simulator uses it; a separate explicit CLI can evaluate Gemini. The interface, operation validation and runtime are ready for a native provider adapter; Native SDK integration and spending guards are now implemented below; live accuracy/cost evaluation remains pending. Mock calls continue to record zero provider cost and null usage. Merchant/provider invoice billing remains future work.

Verification evidence: workspace 03-Output/003-agent-tool-core-verification.md. The simulator runs at http://localhost:3017. Docker keeps state in the existing shopbot-ai-local named volumes. Original foundation evidence remains in 03-Output/001-foundation-verification.md.

## Completed: KSMC demo catalog cleanup

All 34 source files are preserved; 30 product records/images are normalized under resources/catalog/ksmc-demo. Three brand conflicts, 11 MRP discrepancies and five stock-unit ambiguities remain explicit. Four cleanup tests passed. See workspace 03-Output/002-catalog-cleanup-verification.md.

This pack is an optional onboarding fixture. It does not replace the six synthetic default simulator products. New native chat sessions now use a distinct 30-product image-demo store. No catalog import is required to continue the reusable engine. Real units/prices/brands and tax treatment still need merchant verification.

## Completed: native text adapter and spending safeguards

Official Google GenAI SDK 2.26.0, a bounded structured-output adapter and a dated gemini-3.5-flash-lite evaluation profile are implemented. Runtime reservations precede provider calls; store-wide fixed cumulative budgets, micro-USD estimates including thinking, unknown-cost holds, bounded recovery and reset protection are tested. SDK hidden retries and automatic tool loops are disabled. An explicit synthetic native evaluation CLI is available; the local HTTP simulator stays mock-only.

Twenty-two integration tests pass with offline provider fixtures. The free-tier CLI requires explicit opt-in and a local key while keeping paid authorization false and budget zero. See NATIVE-AI.md and workspace 03-Output/004-native-adapter-verification.md.

## Next: authorized live text evaluation, then WhatsApp

Current user constraint: Gemini free tier only; paid flag false and budget zero. Durable project/model guards implemented. Initial validation failure diagnosed as kind=add versus add_item; strict provider-wire translation fixes it. Real five-item browser smoke passed: ₹914 review and 728 tokens. All 24 integration tests pass. Separate free-only local page available at http://localhost:3017/native-test; default simulator stays mock. See workspace 03-Output/006-live-ai-browser-verification.md. Broader correction/clarification/language evaluation and WhatsApp remain next.

## Limits and later work

Local mock simulator plus a signed-session free AI test channel; one submitted request per demo conversation, with amendments/new-order lifecycle deferred. Customer tool scopes are checked in code and tested, but production identity verification, database access policies and full tenant isolation are not implemented. Search is a fixture-scale store scan.

Photo/voice, live WhatsApp, broader live AI evaluation, owner authentication/MCP, staff approval/packing/readiness, stock reservations, merchant payments and usage invoicing remain later milestones. Customer confirmation means only awaiting shop approval. No paid provider calls or customer messages were sent.

Input archive task/status documents are immutable planning references, not this build's implementation status.

## Conversation experience — implemented

Friendly persona, cheap greetings, bounded recent context, ambiguity/packaging clarification, typo suggestions with exact numeric specs, one-message rich replies and a WhatsApp-style test UI are implemented. New native conversations use a separate 30-product image-demo store; six-product default simulator and prior histories remain. Photo choices are capped at ten, with no automatic fanout/paging. Owner planning rate is configurable; real Meta cost/capability enforcement is specified in a pure tested planner. Build and 28 integration tests pass; live screw-box-plus-paint clarification passed with one 1933-token generation. See WHATSAPP-EXPERIENCE.md and workspace 03-Output/007-conversation-verification.md. Source catalog review flags and broader language/typo testing remain unresolved.

## 2 October 2026 — customer and technician edge cases

Three Luna agents evaluated/retested ordinary and technician conversation paths in isolated schemas. Fixed natural edit wire fields, contextual short answers, pause/clear/remove-it, stale-question replies, unit/packaging mismatch clarification, catalog quote totals, mixed owner questions, exact SKU refresh identity, and cheapest permitted WhatsApp planning. Evidence: ../../03-Output/008-order-edge-cases.md. Native channel remains an explicitly enabled free-only local preview.

Final edge-case validation: 41 integration tests pass. Explicit price inquiries and variant quote buttons are read-only; Add to my list is a separate explicit action. The generation schema remains the compact canonical contract, with strict response-only compatibility aliases.

## 2 October — bounded agent discovery and recovery

The native assistant can now choose search_products queries for job-based discovery and alternatives, receive current and remembered tool observations, and ask a focused model-authored question. Scoped persistent assistant memory is separate from the order draft. Read-only exploration/quotes remain distinct from additions. Explicit lineId binds alternatives to the current pending item; unrelated choices add a new item without replacing an old request. Short answers are bound to the currently displayed search/question/review.

“Check again” reuses the remembered goal and reruns real catalog tools without inference. Quote rechecks keep their original product/quantity/unit. Compound product words can match split names without numeric/packaging conversions. Quota denial now describes the limit accurately. One outbound rich reply, maximum ten cards, no automatic model loop or hidden retry. Build/typecheck and all 53 integration tests pass in isolated schemas with scripted/offline provider fixtures. Controlled live evidence is recorded in workspace 03-Output/009-agent-discovery.md.

Final live check passed: job-based PVC cutting request → actual cutter/blade image choices + pipe-diameter question, one 2753-token generation, empty order draft. Three successful Gemini generations were used across this refinement turn; deterministic rechecking used no additional generation. Local server is healthy and paid authorization remains false. Evidence: ../../03-Output/009-agent-discovery.md.
