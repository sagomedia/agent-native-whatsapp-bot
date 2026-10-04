# Owner dashboard foundation — 4 October 2026

Added an opt-in owner preview at `/owner`: scoped conversation history/takeover, request accept/reject, connection/usage status and persisted shop-wide pause. Every owner API verifies a Cloudflare Access RS256 signature, pinned issuer/application audience, expiry and the exact configured owner email; store membership comes from server configuration. Writes require the matching HTTPS Origin and an explicit same-origin JSON header. Public owner routing excludes simulator/native-test endpoints. Migration 15 adds controls and an owner audit trail. Takeover invalidates in-flight work leases; worker/store locks prevent a reply being saved across pause/takeover changes. Manual sending and customer decision notifications remain unavailable until a real channel adapter is implemented.

The owner preview requires loopback binding, mock mode and local AI disabled. No live WhatsApp sender or AI is enabled. Node 22 production build and all 111 isolated integration tests passed; focused authorization/control tests additionally cover takeover followed by resume while interpretation is in flight. Cloudflare publication and VPS configuration are separate deployment steps; see workspace `03-Output/020-owner-dashboard-and-whatsapp-test-audit.md` for current execution evidence.

# Current correction: intent-led discovery

English simulator controls and an independent Tamil/Tanglish/English bot reply preference. Fixed the reported 42mm pipe-cutter lookup failure; support up to six relevant photos, practical AI job questions and remembered purchase quantities through browsing. All 109 regression tests and the production Node 22 build pass. See INTENT-DISCOVERY.md and workspace 03-Output/016-intent-discovery-verification.md for final validation.

# Tamil-first customer demo — 4 October 2026

Implemented saved Tamil/Tanglish/English preference, default Tamil native sessions, localized customer UI/media controls/product choices/quantity/order review/error replies, localized catalog names/families, bounded Tamil/Tanglish shortcuts and actual-transcript language preference changes. English requires explicit customer choice. Language switches preserve draft versions, products and consent bindings. Optional-null planning fields are normalized without weakening required/unknown-action validation. Fixed the submitted-request acknowledgement being overwritten by a generic yes reply.

All 99 isolated regression/integration tests pass in the production Node 22 container. Typecheck/build and deployed local health pass. Three successful free-only live synthetic attempts verified Tamil selection/review, Tanglish multi-item quantities and Tamil photo matching, with no submitted orders. Local deployment and live free-tier evidence are recorded in workspace `03-Output/015-tamil-demo-verification.md`. Instructions: `TAMIL-DEMO.md` and workspace `HANDOVER.md`. No GitHub remote/remote deployment or WhatsApp connection is established yet; repo name/URL and intended VM confirmation are pending. Read-only checks verified sagomedia GitHub sign-in and candidate hermes-mcp-test / sago-counter-ksmc / us-central1-a / e2-micro. Owner terminology review and fresh actual Tamil/Tanglish voice evaluation remain.

---

# Image upload — 3 October 2026

Customer product-photo upload/search is implemented and running on `/native-test`: Upload image → preview → optional caption → Find matching products. JPG/PNG/WebP under 2 MB; scoped normalized images; one free-only visual planning call; read-only catalog suggestions; explicit product selection and separate review consent.

All 90 regression tests and typecheck/build pass. A real demo cutting-wheel photo with a Tamil caption matched H14; selecting it and typing quantity 2 produced a separate ₹70 review with one successful inference and no submitted order. The initial live attempt failed validation; two total free attempts were used. Full Tamil/Tanglish replies remain a separate milestone. See `IMAGE-SEARCH.md` and `../../03-Output/014-image-upload-verification.md`.

---

# Language and storage audit — 3 October 2026

The local app is healthy. Fixed Tamil normalization to preserve vowel marks and changed voice players to load duration metadata. All 83 offline regression/integration tests and the Docker typecheck/build pass. All 30 demo product JPEGs load; the existing Tamil voice note plays for 5.4 seconds.

Three guarded free-tier synthetic text attempts used zero paid inference: English and Tamil failed structured-output validation without changing drafts; Tanglish preserved quantity two, offered actual H14/H15 photos and replied in English. Complete multilingual replies and reliable output planning are not ready. Personal voice retransmission was blocked pending explicit approval, so no additional personal recording was sent. No test order was submitted.

Current next phase: fix the planning-output validation failures, add reviewed Tamil/Tanglish replies and language preference, then validated merchant catalog/media import. Read `../../03-Output/013-catalog-storage-and-language-guide.md` and its preparation kit.

---

# Current checkpoint — 3 October 2026

Indexed generic catalog hierarchy, keyword retrieval, scoped narrowing callbacks, explicit product photos and recorded voice are implemented and deployed locally. All 82 integration/regression tests, typecheck, Docker build and final live text/audio desktop/mobile checks pass. The voice request preserves two pipes and five bottles of solvent; checking both photos produces a separate ₹1,185 review, with no submitted order.

Try `http://localhost:3017/native-test`, refresh and choose New chat. Broad discovery and voice use one free-only call each; refinements, typed quantity replies and photo buttons can use backend tools without extra AI. Actual WhatsApp delivery and merchant onboarding remain separate milestones. See `CATALOG-DISCOVERY.md`, workspace `GIT-WORKFLOW.md`, and `03-Output/012-catalog-mindmap-and-voice.md`.

---

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
