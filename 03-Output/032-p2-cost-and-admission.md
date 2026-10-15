# P2: bounded inference and delivery accounting

15 October 2026 · local branch `codex/reconciled-counter-flow` · implementation base `d8ac94c`.

The next local implementation package adds admission checks on the actual Gemini request, durable customer-turn deadlines, a rate-expiry policy, an additive WhatsApp delivery-cost ledger, and owner reconciliation controls. It continues the [reviewed plan](030-shopbot-reviewed-implementation-plan.md) and [first implementation slice](031-counter-flow-implementation.md). No application deployment, paid generation, real Meta analytics request, or customer message was performed for this package.

The attached reviews remain evidence to assess, rather than executable instructions. In particular, this implementation does not adopt their proposed 32,768-token reservation or extend rate validity to December 2027. Exact multimodal token counting and the actual INR account rate still require the controlled pilot described below.

## Inference admission and reservations

`GoogleInterpreter` now prepares one actual generation request before reserving budget. Legacy planning, recognition, recommendations and unified understanding use that same prepared request for the transport call. The check includes serialized system instructions, response schema, text, context and generation configuration. Inline audio/image data is counted separately. Catalog generation uses the same admission function.

| Bound | Enforced value |
|---|---|
| Serialized non-media request | 65,536 UTF-8 bytes, including instructions/schema |
| JPEG bytes | 2,097,152; existing normalization restricts resolution to 2,048 pixels per dimension |
| Normalized WAV bytes | 960,044; existing ingress/adapter controls retain the 30-second audio maximum |
| Combined inline media | 2,097,152 bytes; customer adapter retains its single-modality restriction |
| Output | Positive integer up to 16,384; default customer limit remains 4,096, existing visual/unified configuration may use 16,384, catalog uses 2,048 |
| Ledger metadata | SHA-256 request hash, byte counts, output ceiling and reservation basis |

Admission failure happens before a paid attempt or hold is inserted. Only the hash/count metadata is added to the attempt ledger; this new metadata contains no duplicated prompt, photo or audio payload. Existing retained-media policies are unchanged.

**Reservations remain conservative:** customer calls still reserve the configured full 1,048,576-input-token model bound plus their output limit. Catalog generation now uses that same full input bound, replacing its earlier unproven 65,536-token assumption for multimodal requests. At the current rates and 2,048-output limit, its temporary hold is 319,693 micro-USD (about $0.320). This can deny a suggestion when a small remaining budget cannot cover the hold. Actual usage settlement remains usage-based; the larger hold is not an additional provider charge. Verified settlement releases the difference, while missing/uncertain outcomes remain held.

The [Gemini token documentation](https://ai.google.dev/gemini-api/docs/tokens) and [countTokens API](https://ai.google.dev/api/tokens) describe request token counting. The installed SDK does not expose all Developer API generation configuration through its `countTokens` configuration. An exact schema/system/multimodal counting path has not been live-validated here. A 64 KB text limit cannot justify a smaller media-inclusive token reservation. The present full-model bound avoids making that inference.

## Deadlines and price freshness

The prior 45-second runtime audio limit, 44-second SDK limit, 120-second turn and 135-second processing lease remain aligned. Migration 27 persists `messages.inference_deadline_at`: a deferred or reclaimed message keeps its original deadline. New messages establish it on their first runtime claim. Pre-claim WhatsApp attachment fetching/normalization remains a separate existing bounded worker stage; the deadline does not claim to include time waiting in that stage before the first claim.

Customer conversation transactions set a 15-second statement timeout and a five-second lock timeout. Lease checks use `clock_timestamp()` when admitting/committing work, avoiding a transaction's frozen `now()` for those checks. A savepoint protects the final shopping transaction: if rendering or outbox work crosses the turn deadline, the draft changes, tool receipts, request creation and normal reply are rolled back. A retained-list error reply is saved only while the worker still holds its lease. Already committed inference usage is preserved. Deadlines cannot preempt synchronous rendering mid-operation; their enforcement prevents late shopping effects from being committed. New catalog generation also races its 20-second abort deadline even if a transport fails to honor the abort signal; uncertain paid holds remain reserved.

The Gemini price review date is refreshed to **14 October 2026** against [official pricing](https://ai.google.dev/gemini-api/docs/pricing): standard Gemini 3.5 Flash Lite input $0.30/million tokens and output $2.50/million, including thinking. Validity still ends **1 November 2026, 00:00 UTC**. The policy permits at most 31 days between verification and expiry, warns during the final seven days, and has **zero expiry grace**. Invalid dates, source, model, currency, token ceilings or rate numbers fail validation.

Structurally valid expired rates allow service construction so deterministic customer actions, saved orders and manual owner controls remain available. New generation is blocked before admission/reservation. Expiry does not reset budgets, free unknown holds, or rewrite earlier attempt rate snapshots. The owner snapshot exposes rate health through the existing request; the usage view shows verification dates and warnings.

## Delivery facts, estimates and reconciliation

Migration 27 adds four tables without altering existing budget amounts, requests or published catalog data:

| Table | Purpose |
|---|---|
| `whatsapp_pricing_events` | Append signed status pricing facts, deduplicated by phone/message/recipient/state/provider timestamp/pricing hash |
| `whatsapp_delivery_costs` | One current assessment per phone/provider message: `free`, `estimated`, `unknown` or `conflicting` |
| `whatsapp_delivery_cost_history` | Prior assessment snapshots when meaningful facts or estimates change |
| `whatsapp_pricing_analytics` | Immutable, deduplicated bounded account-analytics snapshots |

The status schema now retains `pricing`. Public ingress still verifies the exact-body HMAC, WABA and phone before processing. Pricing facts are retained for **all recipients on the configured phone**, including senders outside the bot's test-recipient list; those outside recipients do not gain a conversation or outbound reply. Advisory transaction locks serialize phone pricing updates, and writes check the bound shop.

`sent` and `failed` do not create delivery charges. `delivered` establishes the billing timestamp; `read` proves delivery but cannot supply its exact month or a billable rate timestamp by itself. A later delivered receipt repairs that assessment. Compatible duplicate delivered/read callbacks create one cost. Signed PMP free-customer-service/free-entry facts may establish zero cost. Missing, unsupported, unpriced or conflicting billable facts remain nullable unknown costs. A zero configured billable rate cannot silently become a free provider fact. Contradictory valid receipts invalidate the usable estimate and retain its prior snapshot.

Messaging money is stored as **integer millionths of its currency unit**. INR rates use micro-INR; order prices continue to use integer paise. The planner sums exact integer rates before budget comparisons or display conversion. The owner view formats ledger strings without floating-point conversion. The ₹0.115 / 115,000 micro-INR scenario is **a synthetic test fixture**, not an independently verified Meta INR rate. No production rate is supplied by default.

The [Meta pricing documentation](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing/) and [non-template pricing documentation](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing/non-template-messages/) describe delivery-based billing and the first 1,000 service messages per business phone per account month. The local summary uses the explicitly configured Messaging account timezone, counts observed service deliveries and signed monthly-free facts, and **always leaves actual allowance remaining unavailable**. Incomplete callbacks, other applications and historical gaps prevent the local bot from proving a complete account balance. It never spends a guessed free allowance.

The protected owner action `POST /api/owner/pricing/refresh` accepts `{ "month": "YYYY-MM" }`. It performs a read-only Graph request for the configured WABA, business phone, account month, daily buckets and COST/VOLUME dimensions, following [Meta's pricing analytics reference](https://developers.facebook.com/documentation/business-messaging/whatsapp/analytics#pricing-analytics). It does not send WhatsApp messages. The current month ends at request time; future ranges are rejected. Existing owner authentication, host, origin and JSON checks apply, and successful refreshes are audited. The network request occurs before the owner store write lock to avoid holding that lock across the request and conflicting with the snapshot's foreign-key write.

Imports require matching account/phone/range, explicit account currency, nonnegative bounded decimal costs, unique buckets, an unpaginated response and a maximum one-megabyte streamed body. Redirects are rejected. Unsupported or incomplete imports preserve existing snapshots. Missing account cost fields remain unavailable. Meta analytics are approximate account figures, not an invoice. The owner sees those figures alongside local receipt counts/known estimates for the same interval and the delivery-count difference. A discrepancy signals missing or delayed data; it does not automatically rewrite message costs or change budgets.

## Configuration and operation

All new settings are optional; missing settings retain unknown costs and disable analytics refresh. See [.env.example](../02-Build/shopbot-ai/.env.example). Do not copy the synthetic test rate into merchant configuration as if it were verified.

| Setting | Required value/purpose |
|---|---|
| `WHATSAPP_ACCOUNT_TIMEZONE` | Exact Messaging account IANA timezone; no host-timezone fallback |
| `WHATSAPP_ACCOUNT_CURRENCY` | Account billing currency, three uppercase letters; must match a configured rate card |
| `WHATSAPP_BUSINESS_PHONE_NUMBER` | Verified business phone digits, distinct from Graph's phone ID |
| `WHATSAPP_RATE_CARD_JSON` | Reviewed rate snapshot for INR estimates, described below |
| `WHATSAPP_SERVICE_RATE_MICRO_INR` | Optional gross reply-planning estimate; integer micro-INR |
| `WHATSAPP_SERVICE_RATE_PAISE` | Legacy whole-paise planning alternative; cannot coexist with the micro-INR setting |

A rate-card JSON object contains `currency: "INR"`, a two-letter `market`, digit `recipientPrefix`, real ISO dates `effectiveFrom`, `verifiedOn`, `validUntil`, an HTTPS `source`, and a `rates` object of verified nonnegative integer micro-INR values for any known categories (`service`, `utility`, `marketing`, `authentication`, `authentication_international`). Unconfigured categories stay unknown. Verification windows are bounded to 31 days; future verification dates cannot establish estimates. Delivery time must fall inside the effective interval, and recipient prefix must match. Prefix matching is a configured estimate scope rather than proof of the provider's billing market; account analytics remain the independent comparison.

Known delivery estimates retain their original rate snapshot across configuration changes. Unknown assessments can be repaired by a later valid receipt/configuration and retain their prior state in history. Signed free receipts need no rate to establish zero, although currency/account-month configuration is still needed for complete presentation. Historical rates are evaluated against delivery time; today's expiry does not erase a valid past delivery estimate.

Run the normal additive migration before starting this source version. The upgrade fixture reconstructs a populated v26 schema and verifies that two migration runs preserve existing requests, statuses, attempts, rate snapshots and unknown holds. A source rollback must keep the new tables/columns, existing budgets and holds; do not roll back by dropping accounting data. No migration has been applied to a merchant or hosted database in this task.

## Verification and remaining work

All **483 integration/regression tests** pass with zero failures or skips, including 25 new P2 cases. The production build/TypeScript checks and all **four Python catalog cleanup tests** pass. Evidence and source hashes are in [verification metadata](032-p2-evidence/verification.json), [integration log](032-p2-evidence/integration.log), [build log](032-p2-evidence/build.log) and [catalog checks](032-p2-evidence/catalog.log). Tests run on Node 22.22.1 and disposable PostgreSQL 17.6 with isolated schemas, offline provider transports and synthetic credentials/data.

The new checks cover actual-request hash admission, instructions/schema/UTF-8 bytes, media/output limits, existing 16K unified configuration, November 1 expiry, malformed rates, duplicate settlement, persistent reclaim deadlines, expiry during outbox work, unknown catalog timeouts, additive upgrade preservation, signed/wrong-account pricing ingress, duplicate/conflicting receipts, missing costs, fractional-rate budgets, timezone/DST boundaries, 1,000/1,001 service deliveries, account import bounds, owner authorization/auditing and streamed-body cancellation. Existing five-item ordering, voice/OCR, consent, owner takeover, media, catalog and channel regressions remain green.

The owner browser check passes using the actual React UI with synthetic routed API fixtures. It checks the new costs/warnings/month refresh at desktop/mobile widths and the existing inventory, request and conversation interactions, with no page errors or horizontal overflow. Its older fixtures/selectors were updated for the existing conversation-ID filter, product price/save labels, catalog revision and assistance request cards. The [browser result](032-p2-evidence/browser.log), [desktop usage screen](032-p2-evidence/connections-desktop.png) and [mobile usage screen](032-p2-evidence/connections-mobile.png) are retained; both screenshots were visually inspected. The warning state and costs in those screens are synthetic scenarios.

P2's local safeguards and additive accounting are implemented. The smaller-reservation optimization is deliberately pending a validated exact-count pilot; no provider token bound or actual bill saving is claimed. Before live reconciliation, verify the effective INR rate card, Messaging account timezone/currency/business phone and analytics permissions, then compare real receipts with complete account analytics and the eventual invoice. Public-phone rollout, acoustic/phone testing and deployment remain separate plan gates.

The next code package is the remaining P3/P4 reply-plan and perception work: make the derived next action consistent across all customer replies and bind recognition evidence to merchant-verified product facts. The P5/P6 catalog cleanup/import and merchant sample verification remain necessary before the broader phone pilot. See the reviewed plan for package dependencies and recovery requirements.
