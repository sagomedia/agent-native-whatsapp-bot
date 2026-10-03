# Agent discovery and follow-up refinement — 2 October 2026

## User issue and diagnosis

The screenshot showed “I want screw driver” followed by “check again” producing a generic understanding failure. The first message had one successful Gemini attempt at 16:39:54.984 UTC; the recheck arrived at 16:40:05.954 UTC, about 11 seconds later, inside the local 15-second gap. No provider attempt was made for the second message. The prior runtime reported local quota refusal as inability to understand. The 30-product image demo contains screws but no screwdriver; substituting screws would be wrong.

The larger limitation was architectural: the AI primarily proposed order edits, while fixed reply templates decided most follow-ups.

## Resulting behavior

- One native decision can choose up to three real search_products queries for discovery, synonyms, job-based requests or alternatives.
- The model receives scoped current searches, recent conversation, catalog names/units, and sanitized remembered search observations. A bounded assistant_memory record persists outside the order draft.
- Read-only discovery does not add products. A search plan can bind an alternative to a current pending line using its exact UUID; unrelated product choices cannot silently substitute that line.
- Explicit selection or a properly bound yes resolves/adds the product. Quantities and review/confirmation remain validated backend actions. Queued short replies cannot approve unseen options.
- Check again remembers the current goal and reruns real catalog reads without a Gemini request. Price rechecks retain the product, quantity and unit.
- Split/compound product words can match, without changing numeric specifications or packaging. Missing catalog listing is distinguished from verified shop availability.
- Local quota denial has accurate customer-facing copy. One model request per turn, existing 3/minute/15-second/100-per-day local guards, paid flag false and budget zero remain. Each customer turn has one outbound envelope and at most ten cards.

## Validation

Full build/typecheck and 53 integration tests pass. Tests use isolated PostgreSQL schemas, scripted interpreters and fake SDK responses; these are not live Gemini accuracy tests. New cases cover missing products/rechecks, new catalog entries, persisted observations, explicit substitutions, independent shopping goals, quote rechecks, stale yes/queued replies, invalid search targets, ungrounded commerce questions, and quota refusal. All prior order, lease, idempotency, price, consent and tenant/actor tests remain passing.

Real browser checks during implementation:

1. “I want screw driver”: Gemini chose a read-only screwdriver search, no false substitute or draft addition, and asked a product question (2625 measured tokens).
2. “check again”: real catalog read with remembered screwdriver goal; no extra provider attempt, no generic error.
3. “I need something to cut PVC pipe. I don’t know the tool name—what options do you have?”: Gemini chose Ratchet PVC Pipe Cutter 42mm and 12 inch Carbon Steel Hacksaw Blade searches. Actual catalog images and prices appeared in one two-card reply; draft stayed empty.

Final deployed build: the same job-based request produced real cutter and blade searches, two catalog image cards, and the focused question “What is the approximate diameter of the PVC pipe you need to cut?” One successful real Gemini request measured 2677 input + 76 output = 2753 total tokens. The order draft stayed empty and no request was submitted. There were three successful live generations during this refinement turn (two initial checks and this final check); the screwdriver recheck made no additional generation. These used the configured Gemini API key, separately from offline scripted tests.

The app is healthy at localhost:3017/native-test. The final discovery conversation is left open for the user. The original default mock demo remains version 6, five draft lines and one earlier submitted request. No database reset was performed.

Screenshots: 009-agent-recheck.png and 009-agent-discovery.png.

## Limits

This is a bounded early agent: the model selects useful search/order actions and clarification, and observes the results on subsequent customer turns. It does not run a same-turn multi-generation autonomous reflection loop. Its tool set is still catalog/draft/review/status; live owner handoff, merchant sourcing, language evaluation, voice/photo interpretation, and WhatsApp delivery remain future phases. The catalog is a fixture, with unresolved merchant verification flags. A purpose-based suggestion is not a verified technical suitability guarantee.

Local test: http://localhost:3017/native-test. Original screenshot conversation and all earlier histories are retained; app restart requires a fresh signed local session. No paid inference or actual WhatsApp/customer delivery was initiated.
