# Next ShopBot implementation plan

Prepared 18 October 2026. Customer testing is planned for **19 October 2026**, in the user's next test session. No time of day or unattended test run is scheduled.

Status: **implementation proposal**. This commit changes documentation only. Work packages, new endpoints, files, thresholds and release candidates below are proposed until implemented and verified. Existing deployed behavior remains the baseline.

## 1. Outcome and baseline

Make catalog maintenance faster, make failures measurable, and prepare a reliable customer test without changing the shopping flow that already works.

The verified running source is `1f3826682f003c9f058f406d8b4c309cafdf9d6f`, release `preview-35d58293082b`, schema 37. That source passed 654 integration tests and four Python catalog checks. Its completion is tracked in [PR #33](https://github.com/sagomedia/agent-native-whatsapp-bot/pull/33) and [issue #32](https://github.com/sagomedia/agent-native-whatsapp-bot/issues/32).

Read-only audit on 18 October:

| Fact | Recorded state | Implication |
| --- | ---: | --- |
| Active products | 336 | Keep the full catalog available during evaluation. |
| Existing nonzero prices | 38 | These are existing catalog values, not newly audited market prices. |
| Separate indicative prices | 297 | Continue showing approximate-price labels. |
| Merchant-price-pending products | 298 | Suggested prices have not become shop-confirmed prices. |
| Unknown stock | 303 | Unknown cannot become zero or an availability promise. |
| Missing photos | 12 | Retain explicit missing-photo presentation until correct assets are supplied. |
| Paint selling-basis hold | 1 | `SHOP-9C41D1AFD61B4C30`: clarify per-litre versus pack/can before setting a price. |

Only one product had each of the stock and selling-unit verification flags set at that audit. A missing flag means review is pending; it does not prove the stored unit or count is wrong. The post-release audit had no customer messages, so it is not evidence of live voice accuracy.

Preserve the current model, bounded retrieval, customer-selected SKUs, buffered new/existing-list request, short clarification buttons, cart correction guards, single invoice image, QR and demo pay-at-shop choice. Jev stays deferred. A missing photo does not authorize a substitute SKU.

## 2. Delivery order

| Package | Deliverable | Dependency | Intended timing |
| --- | --- | --- | --- |
| A | Baseline, issue export, test cards and read-only operational summary | Existing records | Prepare first, before tomorrow's session. |
| B1 | Export, validate and preview bulk shop-fact updates | A; no merchant file needed to build | Next implementation priority. |
| B2 | Guarded bulk apply, replay and dashboard import screen | B1 plus automated checks | Build after preview is sound; apply real values only when supplied. |
| C | Focused catalog/photo/Tamil cleanup | Owner facts or reviewed wording | Prepare lists now; complete available rows without blocking A/B. |
| D | Fresh WhatsApp customer sessions and scored evidence | Frozen tested release; participants | Tomorrow, 19 October. |
| E | Fix demonstrated failures and evaluate realistic scale/concurrency | D's labels and observations | Follow the customer session. |
| F | Automatic payment reconciliation | Chosen merchant/provider integration | Separate production workstream. |

The smallest useful pre-test delivery is **A + B1**. B2 and targeted cleanup are separate changes; do not make tomorrow's customer session depend on completing every dashboard feature. Routine automated checks accompany code changes; customer acceptance remains tomorrow.

## 3. Package A — make tomorrow observable

### A1. Preserve a baseline

- Record source commit, artifact fingerprint, catalog revision and enabled demo options in a private session manifest.
- Export current catalog issue counts and affected SKUs, names, units and available reference-photo links. Do not export customer contact details into catalog files.
- Create an explicit list of the 12 photo gaps, the paint-unit hold, unknown stock and pending shop prices. Reuse existing catalog exception filters.
- Pin one release for each test session. If a fix is deployed, start a new session and report the results separately.

### A2. Read-only operations summary

Extend the existing owner connections/usage surface. Reuse `provider_attempts`, inference budget records, media state, messages, outbox state and runtime release records. Proposed API: `GET /api/owner/operations/summary`.

Show actionable counts: pending/processing work and its age, failed media, delivery failures, unknown send outcomes, blocked inference budget and operator pause. Link each issue to the existing conversation/interpretation evidence. Missing timestamps or unknown cost must display as unknown.

Keep this summary read-only. Preserve existing retry and idempotency controls: an uncertain send is not automatically resent. This work adds no outbound customer messages or external email/Slack notifications.

### A3. Session measurements

Collect, where existing records support it:

- Customer turns, actual outbound messages and completed/submitted requests.
- Media failures, clarification turns, correction success and human intervention.
- AI usage/cost, including failed attempts and retries; report unknown charges separately.
- Server receipt-to-first-useful-reply queued, provider acceptance and phone delivery as separate timings. Typing indicators are not useful replies.

An inbound message's existing `created_at` may originate from the customer's WhatsApp timestamp. Add a nullable server receipt timestamp if needed; do not rewrite historical timestamps or pretend old records contain this measurement. Use monotonic elapsed time within a process and server timestamps for persisted stages.

Attribute multi-part replies through `response_to`/reply groups. Deduplicate attempt and outbound aggregates before joining; avoid multiplying cost by the number of cards or parts. Map multiple lists in one conversation to the private test-session/request IDs. Leave ambiguous attribution unallocated. Add a stable cart/journey identifier later only if existing identifiers cannot reliably separate lists; do not change cart semantics just to obtain a metric.

### A4. Demo evidence collector

Add a read-only demo session report, initially CLI-based, with JSON/Markdown summaries and private references to phone screenshots/recordings. Reuse the evidence conventions in `scripts/pilot-evidence.ts`.

The existing production pilot gate requires a real merchant store, verified product facts, at least 20 completed requests and its required scenarios. **Tomorrow's 10 demo sessions do not satisfy that gate.** Use a separately labelled `demo_usability_review` report; retain the production gate unchanged. Screenshots, source media, conversation IDs and customer identifiers stay private; GitHub receives anonymized failures and aggregate results.

Acceptance: a read-only report can identify a deliberately failed media item and an unresolved delivery without sending messages, retrying work, changing stock or marking payment received. Fixture summaries cannot claim a real customer test passed.

## 4. Package B — bulk shop prices and stock

### B1. Export and preview

Provide **Export shop-facts sheet → edit supplied facts → upload → preview changes** within Products. Existing product pagination and filters remain. The backend exports the explicit selected/filter scope across all pages, not just the 25 rendered rows. Show the scope and total before export/import.

Proposed v1 input columns:

| Column | Meaning |
| --- | --- |
| `sku` | Exact existing SKU in the authenticated shop. |
| `product_version` | Version exported with the product. |
| `inventory_version` | Independent stock version exported with the product. |
| `product_name`, `selling_unit` | Read-only context; mismatches require a refreshed sheet/review. |
| `shop_price_inr` | Actual shop price per displayed selling unit; blank means no change. |
| `price_status` | `priced` or explicit `free` when changing price. |
| `confirm_price` | Explicit confirmation for the supplied shop price. |
| `on_hand_quantity` | Physical shelf count, including reserved stock; blank means no change. |
| `confirm_stock` | Explicit confirmation for the supplied physical count. |
| `note` | Source/date or reason for the update. |

CSV is the owner-facing format; normalize it into versioned JSON for validation and application. Parse quoted fields and Unicode correctly. Preserve decimal strings until exact paise/milli-unit conversion; do not use floating-point currency arithmetic. Formula-looking cells must be escaped in spreadsheet exports and never executed on import.

Rules:

- Blank is unchanged; `0` is an explicit value. A zero price requires explicit `free` plus confirmation. A zero stock count is valid when reservations permit it.
- No fuzzy SKU matching, new products, deletion, identity/unit edits, automatic stock estimates, or automatic approval of unrelated verification flags.
- Validate currency, selling basis, quantity increments, duplicate SKUs, row/byte limits and shop scope. Proposed initial limit: 3,000 rows and 2 MiB.
- Keep suggested prices separate. A supplied actual price can replace its indicative display through the existing invalidation rules; a stock-only update retains the indicative metadata.
- Return row-numbered errors and a before/after preview. Unit conflicts stay in the review queue. Opening a preview does not write product facts.

### B2. Apply and replay

Proposed API surface under authenticated `/api/owner/catalog/facts/`: export, preview, apply and batch status. Reuse current owner authentication/origin checks and audit conventions. Proposed new service: `services/catalog-fact-imports.ts`; use the next available additive migration only for the durable batch/snapshot records actually needed.

- Bind preview to file hash, owner store and frozen product/inventory versions. Expire unused previews after a documented bounded interval.
- Apply only the previewed fields. Recheck current versions and reservations under the existing store-first, sorted-product lock order.
- Reuse `adjustStock(... kind: 'count')` and the inventory movement ledger. Never assign `products.stock` directly from the sheet or overwrite reserved quantities.
- Keep catalog `version` and `inventory_version` distinct. Actual price/price-verification changes invalidate old quotes through normal product-version handling. Stock counts use inventory versions. Updating price and stock on one row is atomic.
- Begin with chunks of at most 50 rows. Each chunk is atomic; show committed, failed and untouched chunks explicitly. A changed or invalid row rolls back its chunk; no silent skipping. Re-measure lock duration before increasing the bound.
- Use a batch ID plus content hash and deterministic row operation IDs. Replaying an applied chunk returns its receipt without repeating price or stock movements; changing data under the same ID is rejected.
- A failed later chunk does not erase earlier committed chunks. Resume only the untouched portion; edited/stale rows need a fresh preview. Corrections are version-checked forward updates, never restoration of an old database over subsequent orders.
- Preserve visibility, photo, identity, selling policy and unrelated verification flags. Mark only explicitly confirmed fact fields reviewed. A price/stock sheet is not whole-product merchant approval.

The UI needs a compact preview, changed/unchanged/error counts, explicit apply action, progress and a downloadable receipt. Keep selection stable by SKU and warn about a stale preview or unsaved editor. Use the same guarded service for the compiled owner CLI; require it in the native package and exercise the compiled executable. Any later MCP write integration must reuse this service rather than bypass its checks.

Acceptance cases: blank versus zero, decimal parsing, wrong shop, duplicate SKU, stale catalog version, independently stale stock version, count below reservations, mid-batch failure, identical replay and changed-payload replay. A price-only patch leaves stock untouched; a count-only patch leaves price and indicative metadata untouched. Existing reservations and submitted order snapshots survive.

## 5. Package C — focused cleanup

### Photographs and selling units

Prepare the missing-photo list now with SKU, product name, size/model/pack and the exact discrepancy to resolve. Correct assets must retain those details. Existing reference photographs remain labelled; generated or visually similar technical products do not establish exact identity.

Keep the current image until an approved replacement is ready. The present direct upload route deactivates a product; a future photo-only workflow should stage a private asset and then atomically approve it for the versioned SKU, preserving the user's authorized review-later visibility and unrelated verification fields. Test that behavior separately rather than forcing every product through full re-publication. Existing image/asset protections and audit remain.

Resolve the paint unit with merchant input. Do not convert litres to kilograms by inference. Unit or product-identity changes invalidate stale approximate prices and quotes using existing guards.

### Tamil wording and search phrases

- Review the most frequent 20–30 customer-facing templates first: welcome, product type, count, product review, invoice, QR, claimed payment, submission, pickup and post-order changes.
- Use the current [Tamil source inventory](../customer-ordering-finish/TAMIL-ALL-DETERMINISTIC-COPY.md). Preserve placeholders, action IDs and transaction meaning; a wording edit must not add another message or model call.
- Turn tomorrow's actual misses into specific, human-checked synonyms or family corrections. Keep ambiguous terms ambiguous until the customer selects; an `MCP`/`MCB` transcription is not authority to assume an electrical rating.
- Distinguish retrieval misses, ranking errors, speech mistakes, wrong edit targets and missing merchant facts. Fix the responsible stage instead of adding broad aliases that match unrelated variants.

Acceptance: approved wording survives WhatsApp limits and real phone wrapping; existing caption, cart correction and eight-row invoice regressions continue to pass. No invented price, stock, quantity or compatible substitute.

## 6. Tomorrow's customer session

Use [TOMORROW-TEST-CARD.md](TOMORROW-TEST-CARD.md) for 10 scripted sessions with 2–3 willing Tamil/Tanglish speakers. Aim for ordinary speech, varied accents and realistic pauses; include a noisy recording where practical. Purchase scenarios should exercise 3–8 items against the full catalog. Price-only and irrelevant-message scenarios intentionally need no order.

Before starting: pin release/catalog revision, check media delivery and owner access, agree expected SKU/unit/count and price status, and open the owner Requests view. Use supplied/demo facts honestly. Stock-reservation tests without verified physical counts run in an isolated fixture shop; live unknown stock stays unknown. QR scanning or a paid claim is not receipt verification, and the demo pay-at-shop route remains available.

For each session record what the person meant, the selected SKU/variant/count, extra clarification, naturalness of wording, invoice readability, actual next action, request visibility, owner action and customer notice. Capture phone screenshots; the dashboard transcript alone cannot prove WhatsApp layout or delivery. Failed and abandoned sessions remain in the denominator.

Required correctness for a test-ready release: no silent wrong SKU/unit/count, unintended linked deletion, duplicate submitted request, false paid status, lost order or stock reservation corruption. Any such failure is a release blocker, even if the interface looks good. Long replies, avoidable turns and awkward Tamil are UX defects to prioritize from the session.

Report counts and sample sizes. Ten sessions can identify defects; they cannot establish a broad accuracy percentage. Queue an expanded 50–100 consented, human-labelled voice request set after the first session, with held-out examples kept separate from the examples used to tune aliases/prompts.

## 7. Package E — evidence-driven reliability and scale

- Reuse the existing 13/300/3,000 SQL evaluator. Report candidate recall separately from chosen-SKU correctness and real speech understanding.
- Add realistic same-family distractors and merchant variants to the labelled set, not just repeated synthetic names. Keep correct answers reachable and preserve explicit size/brand/unit constraints.
- Rehearse 1, 5, 10 and 20 simultaneous sessions against a private catalog clone with a synthetic sender. Measure SQL, queue wait, inference time, image generation, owner API latency and end-to-end time separately. No load traffic goes to customer WhatsApp numbers.
- Check stock acceptance races, cancellation/replay, stale callbacks and owner/bot overlap through targeted transaction regressions. Reuse current provider concurrency limits and quota/budget controls.
- Record p50/p95, sample size, timeouts, outbound count and actual/estimated/unknown cost per attributable completed order and separately for abandoned sessions. Set performance targets from the measured baseline; do not relabel SQL latency as complete voice-order latency.
- Prioritize the slowest or most frequently failing measured stage. Increase VPS resources only if CPU, memory, database or storage measurements identify that constraint.

Package F stays separate: select a real merchant payment integration, validate authenticated notifications against amount, currency, reference and order, handle duplicates/late capture/refunds, and reconcile before marking receipt verified. The current manual verification path and demo behavior continue until that work has its own reviewed evidence. It needs merchant/provider information; it does not block A–E.

## 8. Implementation locations and checks

Paths below are relative to `02-Build/shopbot-ai/`. Proposed new files/endpoints are explicitly identified; reuse existing modules for transaction semantics.

| Area | Existing starting point | Proposed addition |
| --- | --- | --- |
| Issue counts and paginated catalog | `apps/server/src/http/owner-catalog-pages.ts`, `apps/dashboard/src/OwnerCatalog.tsx` | Focused issue shortcuts and scoped export. |
| Bulk facts | `apps/server/src/services/catalog-products.ts`, `inventory.ts`, `indicative-prices.ts`, `catalog-bulk.ts` in the same directory | Fact import contract/service/routes, durable receipts, preview/apply UI and compiled CLI. |
| Operational summary | `apps/server/src/http/owner.ts`; `apps/server/src/services/whatsapp-channel.ts`, `inference-budget.ts`, `messaging-cost.ts` | Read-only operations summary and missing receipt timing. |
| Demo evidence | `scripts/pilot-evidence.ts`, `evaluate-unified.ts` | Separate demo report and stronger human-labelled expectations. |
| Language/correction | `packages/contracts/customer-copy.ts`, `language.ts`, `channel-text.ts`; `apps/server/src/services/shopping-corrections.ts` | Reviewed wording and targeted regression cases from observed failures. |
| Scale and release | `scripts/evaluate-catalog-scale.ts`, `scripts/catalog-capacity.ts`, `deploy/native/` | Clone-based concurrency evidence and exact source/artifact receipt. |

For changed transaction code: focused PostgreSQL tests first, then typecheck/build and the complete integration/catalog checks. Use disposable local databases. Review the actual compiled CLI, phone-sized dashboard and channel payloads. Snapshot and version-check imports before applying supplied data. No new tests are needed for this documentation-only plan.

## 9. GitHub and release boundaries

Track implementation as small linked PRs:

1. Read-only readiness report and demo evidence preparation (A).
2. Shop-fact export and preview (B1).
3. Atomic batch apply, replay, compiled CLI and dashboard controls (B2).
4. Targeted catalog/photo/copy repairs from reviewed input (C).
5. Customer findings and measured scale/reliability fixes (D/E).

Each PR records the concrete behavior, changed schema, validation, remaining input dependencies and release fingerprint if deployed. Keep test failures as anonymized reproducible cases in GitHub. Keep private recordings, credentials, phone numbers and commercial uploads outside Git.

Admin-only functionality can remain behind a feature flag while tomorrow's existing customer flow stays stable. Apply additive migrations through the verified release path with a fresh private backup. Never switch the release mid-session or count replay of old stored messages as a new phone test. Preserve existing quote, payment, reservation and amendment checks.

Implementation staffing follows the user's preference: GPT-6.1 Sol/high for transaction design and code; Luna/xhigh for bounded documentation/fixture/copy assistance when suitable. The earlier Luna/low request concerned indicative prices; it does not authorize estimated stock or merchant approval.

## 10. Information dependencies

| Needed input | Work it unlocks | Work that continues without it |
| --- | --- | --- |
| Shop price sheet and physical counts | Applying verified prices/stock | Export, parser, preview, guarded service, UI and fixture checks. |
| Correct photos and paint selling basis | Closing the affected catalog issues | Issue export, staged asset workflow, unrelated catalog fixes. |
| Preferred Tamil wording | Replacing reviewed phrases | Evidence tooling and existing short wording remain usable. |
| Tomorrow's participants and expected product choices | Live usability/voice scoring | Test cards, private evidence schema and baseline report. |
| Merchant payment provider details | Automatic receipt reconciliation | Existing QR/manual verification and all other packages. |

If input is unavailable, leave that fact pending and continue the independent package. Do not stop all implementation or manufacture a fact to complete a checklist.
