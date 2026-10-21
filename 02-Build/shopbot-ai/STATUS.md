# Local dashboard usability candidate — 21 October 2026

Four daily destinations, direct work shortcuts, adaptive quote guidance, two-click routine price updates, explicit stock tasks, inline bulk facts, bounded queue search/pagination and daily Tamil controls are implemented locally. Existing owner commerce functions are retained. Build/typecheck, 19 focused owner tests, four catalog checks, synthetic browser checks and a real local API browser check pass. Full regression is 838/840; the same two customer-conversation failures reproduce on the untouched baseline and are tracked in issue #53. See [implementation and verification](../../03-Output/dashboard-usability-20261021/README.md). Physical-device/staff acceptance remains open under issue #52. This candidate is not deployed.

# Local P2 safeguards — 15 October 2026

The local branch now admits the actual multimodal generation request before reservation, persists deadlines across customer-message deferrals/reclaims, rolls back shopping effects when rendering/outbox work passes the deadline, exposes Gemini rate freshness, and records authenticated WhatsApp delivery pricing with exact micro-INR estimates and optional account analytics. Additive migration 27 preserves earlier budgets, holds, attempts and requests. All 483 integration/regression tests, build/typecheck and four catalog cleanup tests pass. See [P2 implementation and verification](../../03-Output/032-p2-cost-and-admission.md) for configuration, evidence and limits. Smaller token holds and live account-rate reconciliation require a controlled pilot; this package has not been deployed.

# Local counter-flow reconciliation — 14 October 2026

The local `codex/reconciled-counter-flow` branch separates product approval from missing-count/unit checks and final bill consent, keeps independent price answers clear, preserves named pipe sizes and all list lines, and aligns audio deadlines with the processing lease. See [implementation and verification](../../03-Output/031-counter-flow-implementation.md) for exact scope, test evidence and remaining plan packages. These source changes have not been deployed; the deployment notes below are historical reports.

# Reported runtime — 13 October 2026

The connected WhatsApp application runs on the Google VPS with Node 22, Fastify, React/Vite and PostgreSQL 17. All application inference uses Gemini 3.5 Flash Lite. WhatsApp ingress/sending, media understanding, visual ordering and the protected owner UI are implemented; deployment and readiness are recorded in the task's release report. A GitHub push/merge and a VPS deployment are separate operations.

The latest source repair prevents an unspecified or pumping pipe from inheriting PVC/hose identity, keeps a current target question ahead of old quantities, retains valid transcript evidence when actions need correction, and requires confirmation for spoken clear-all. See [voice repair plan](VOICE-ORDER-REPAIR.md). The dated notes below describe historical stages, not current connection status.

---

# Current Tamil Multimodal Deployment - 6 October 2026

Sequential list update: `preview-d385c6bec164`, activated approximately 02:08 India time, supersedes `preview-64e2a28156e0`. All 163 isolated regressions and build/typecheck passed. `WHATSAPP_SEQUENTIAL_ITEMS_ENABLED=true` uses the first unfinished requested line as the active product/quantity question, retaining all other lines. Unknown quantities and unit conversions are resolved before the next product. Initially exact complete requests retain grouped All correct confirmation; once step-by-step selection begins, subsequent items remain sequential. Submitted-order proposals preview only the first category and preserve the full list on start or selection. Final review shows quantity, catalog unit price and line total with separate final consent. Old requests, budgets and histories were not reset; no old recording/request was automatically replayed. Native channel progression is regression-tested; a fresh customer phone round trip with this version remains to be checked.

Latest delivery fix: `preview-64e2a28156e0`, activated approximately 01:57 India time, supersedes `preview-19d8309a4205`. All 159 isolated regressions and build/typecheck passed. The customer's fresh 10.92-second audio was decoded and both AI stages succeeded, but Meta rejected its carousel with `131009`: two ambiguous pipe cards had duplicate Start this list titles. The renderer now uses a distinct shop-handoff secondary button across that carousel and validates per-card title uniqueness before sending. A guarded recovery used the saved response, preserved the original rejected outbox and immutable requests, and made zero additional AI calls. Meta confirmed the corrected Tamil carousel delivered. Production estimated committed spending is $0.008939 with no holds; budget caps and evaluation ledger remain unchanged.

Current agent recommendation update: `preview-19d8309a4205`, activated approximately 01:42 India time, supersedes `preview-e200cb77911d`. All 158 isolated regressions and build/typecheck passed. Media-only second-stage planning uses fresh matching catalog facts to ask one useful question above up to four real product photos. New multi-item proposals show photos immediately; selecting a current photo starts every requested line and confirms only that product, preserving other quantities and immutable old requests. Number-word dimensions normalize to strict catalog matching. Audio decoding/inference deadlines and leases are bounded for the small VPS, without model retries or local STT/TTS. Failed attachments offer short localized browsing/handoff replies.

The latest 8.78-second WhatsApp audio was privately recovered through the media API and recognized as a one-inch pipe plus one blade. Pipe quantity stays unknown; blade quantity is one. Isolated recognition/recommendation checks passed, followed by one audited authorized replay. Signed Meta status confirmed its Tamil four-card carousel delivered, with a pipe-brand question first. Production estimated spending is $0.007370 with zero holds; retained evaluation estimates are $0.019873 plus $0.414516 conservative unknown-cost holds. The existing $4.50/$0.50 application caps remain unchanged. Live selection was not fabricated; selection and list-preservation behavior have regression coverage. Previous deployment notes below are historical.

Final follow-up activated on 6 October 2026 India time: `preview-e200cb77911d`. All 153 isolated regressions and production build/typecheck passed. Submitted-order context is hidden from new identification; multi-item follow-ups retain separate quantities behind one bound Start this list button. Real saved voice checks distinguish one blade from one-inch pipe and leave the old order unchanged. Final photo checks recognize the actual nail without a fake screw match, cutter H19 and blade H16. Catalog-independent photo recognition uses supported specification-key names only; unknown attributes become keyword clues. Retained evaluation estimates: $0.017608 plus $0.384615 unknown-cost holds; production estimates: $0.006092 and no holds at deployment audit. The latest release is live; its exact fresh phone round trip remains to be checked. Earlier voice/photo replies were confirmed delivered, but exposed the bugs that this release fixes.

This section supersedes historical free-only/media-disabled statements below. Tamil-first text, optional Tanglish/English, private WhatsApp photo/voice ingestion, compact single-call Gemini identification, deterministic catalog tools, four-option discovery, bound carousel menus and once-only typing indications are implemented. Schema 19 is active on the existing VPS. Paid inference is explicitly authorized with a retained $4.50 production application budget plus a separate $0.50 evaluation budget; free-tier and local live-AI switches are off. No local STT/model or TTS is installed.

The initial seven real text/photo cases passed at estimated cumulative cost $0.005657. Desktop/mobile Tamil/Tanglish preview checks passed without overflow or JavaScript errors. The allowlisted chat was resumed from owner handoff with explicit approval. Its first real voice test exposed an attachment failure and omitted transcript; dedicated JSON-mode instructions fixed the saved-recording case. Subsequent real messages exposed separate follow-up and photo-filter failures, covered by the final tests above. Backend validation requires transcripts; downloads retry only bounded transient failures and retain safe decoder-specific error codes. See `CUSTOMER-EXPERIENCE.md` and `../../03-Output/customer-experience-vps-deployment.md` for release, budget and verification details. Broader merchant inventory/accuracy evaluation, attachment retention and fulfillment remain future work.

# Historical AI quota — 5 October 2026

Requested free AI quota increase deployed to the VPS: 10 requests per rolling minute, 6-second spacing, shared 200K input-token guard with retained 64K unknown reservations. Daily application cap remains 100; paid inference stays off. Build/typecheck and all 115 isolated tests pass. This limit update does not activate the still-unwired native WhatsApp AI/media adapter. See `../../03-Output/024-ai-request-limit.md`.

# WhatsApp test channel — 5 October 2026

**Activation update:** automatic processing/sending are now enabled with explicit user authorization, restricted to verified recipient ending 7308. Actual inbound hi/hello were processed and their replies confirmed delivered through signed Meta callbacks. AI/free/paid inference remain off. See `../../03-Output/023-whatsapp-automatic-replies-enabled.md` for activation, backup and evidence; this supersedes the pending test in the paragraph below.

Implemented and deployed a signed, asset-scoped WhatsApp receiver and durable text sender, retaining the private owner dashboard and existing retail VPS tunnel. The owner approved the public test privacy policy, saving its Meta URL and separately publishing KSMC RETAIL. Meta now shows Published. The user-selected existing test sender/recipient produced a real hello_world bootstrap send and signed delivered callback; the actual phone reply and bounded automatic conversation test are pending. Processing/sending gates and all AI/paid inference remain off. Initial interpretation is deterministic English over the demo catalog. Production build/typecheck and all 114 isolated tests pass. See `../../03-Output/022-whatsapp-connection-progress.md` for exact evidence, deployment, backups and outstanding work.

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

## 5 October 2026 — interactive ordering candidate

Native session media carousels (2–10 cards), single-photo buttons, category/list menus, quantity choices, combined product acceptance and final review/confirm/edit controls are implemented based on `d9cf10e`. Durable action bindings are checked against customer, version, question binding and delivered message. Migration 17 adds stored outbox payloads/actions. Public catalog-photo delivery is store-scoped. The live rollout on 5 October applied the migration and exact tunnel route; WhatsApp confirmed delivery of a four-product cutter carousel at 09:03 UTC. A real carousel tap exposed the separate `button.payload` callback format, now supported and covered by the 13 passing channel tests. See `WHATSAPP-INTERACTIVE.md` for API research and remaining device visual checks.
# Customer Experience VPS Release - 5 October 2026

Deployed `preview-5c7bf76887e7` with the customer quick-action/editing flow, owner handoff/manual replies, Tamil/Tanglish interface and new-chat WhatsApp Tamil default. All 138 isolated tests and the production build passed. VPS readiness, migration 18, installed quick-action rendering and unchanged environment were verified. Existing test chat language preferences remain unchanged; attachment and staged-discovery features remain off. See `../../03-Output/customer-experience-vps-deployment.md`.
