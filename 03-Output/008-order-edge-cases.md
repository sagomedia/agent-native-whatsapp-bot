# Customer and technician ordering evaluation — 2 October 2026

Three GPT-6 Luna agents tested/reviewed ordinary customer, technician and conversation/cost behavior. They ran shared runtime transcripts using MockInterpreter or explicitly scripted interpretations in isolated PostgreSQL schemas, then reran the failing conversations after fixes. They did not call Gemini or alter existing demo sessions. The parent separately used the configured free-tier native channel for synthetic language tests. Mock parser behavior is not a claim about live language-model quality.

## Findings and changes

- Natural edits: a live Gemini correction used `lineId` for set/remove operations while the backend requires `reference`. The strict provider wire adapter now accepts only the equivalent validated UUID fields and translates them; unknown fields or privileged operations still fail. The native prompt includes concrete edit examples.
- Contextual short answers: a yes to a single product choice selects that choice, a yes at quantity asks quantity, and submission remains bound to an explicitly displayed current review. Number words work for quantity. Ambiguous cardinal answers to size questions do not become product search terms.
- Conversation interruptions: greetings/thanks and standalone shop inquiries keep pending questions/reviews unchanged and avoid replaying photos. Pausing/declining keeps the list; explicit clear-list removes draft lines; remove-it targets only the currently bound question. Queued contextual replies cannot modify a different later question.
- Technician measurements and packaging: `requestedUnit` is preserved. Incompatible feet/pieces or loose-pieces/boxes create `needs_unit`; the requested amount is retained and excluded from totals until the customer explicitly provides the catalog unit. No automatic piece/pack/length conversion is inferred.
- Product identity: a Luna rerun caught a loose-screw line being refreshed as a box because searching its SKU also matched tokens in the box name. Exact SKU identity now takes precedence over text/alias search for lookup and refresh. A regression verifies both identities, unit prices, review totals and submitted snapshots.
- Quotes: quantity-specific price queries remain read-only and use backend catalog arithmetic. Incompatible units do not get an invented total. Copy uses appropriate plural unit names.
- Owner questions: delivery area/timing/charges, trade discounts, opening hours, technical compatibility and unverified availability get truthful shop-confirmation responses. Mixed shopping/questions preserve the requested items without adding the question as a phantom item. No owner commitment or handoff delivery is invented.
- Message costs: replies remain one durable envelope, cards stay capped at ten, social/common quantity/choice/inquiry replies need no model call, and the future WhatsApp planner selects the cheapest eligible approved carousel only with explicit marketing opt-in and a sufficient budget.

## Live baseline

The synthetic technician order “Anna, I need 1 inch elbow 6, tee 4 and ball valve 2. I will pick up today.” resolved three products and an exact ₹650 pickup review. Its natural quantity correction and delivery/trade-price question failed schema validation, leaving the draft untouched. A diagnostic correction isolated the field-name mismatch. A 20-foot PVC pipe request retained a product choice, without converting it into pieces. These five native generations were spaced within the durable project quota; paid inference remained disabled.

## Validation

Final native/UI verification and healthy runtime are recorded below after deployment. No WhatsApp/customer message or payment is sent by this local test channel. Catalog demo claims, stock units, owner hours/delivery/discount policy and pack conversions still require merchant verification; broader multilingual and longer-session quality remains a future evaluation scope.

The extended alias-generation schema was rejected by the live provider (HTTP 400). Generation now uses the compact canonical interpretation contract; equivalent wire aliases are accepted only on validated response ingestion. SDK calls still have one attempt and no automatic retry. Build/typecheck and all 39 integration cases pass.

## Luna rerun transcripts

Customer: “some PVC elbows and tape” -> size choices; “three” -> asks whether it is a quantity, keeps both lines; “the first one” -> quantity question; “three” -> advances to tape; “yes” -> asks how many rolls, without submitting. “Cancel that” keeps the list; “remove it” affects only the pending line; “clear my list” clears only the unsubmitted draft.

Technician: feet versus pieces stays unresolved without a guessed conversion. “Actually make the copper wire only 2” changes that line while keeping box quantity. “How much for two PTFE tape rolls” returns a read-only ₹70 demo quote. “I need two PTFE tape rolls and can you deliver today?” creates only the tape line and includes delivery confirmation language in the same reply. Exact loose/box SKU refresh identity now has a submitted-snapshot regression.

## Final native conversation

In the rebuilt preview, the technician shorthand order resolved the exact three catalog items and ₹650 review. “Can you deliver today and give me the plumber rate?” returned the trusted delivery/trade-price clarification with no additional inference. “Actually make the tees only 2 and remove the ball valve” kept 6 elbows, changed 4 tees to 2, removed the valve and produced the exact ₹220 review. Three reply envelopes and two model calls, no submitted request. Screenshot: 008-edge-case-preview.png.

Runtime health is ready. Original mock demo remains version 6 with five lines and one previously submitted request. Paid inference is false and configured budget is zero.

The live measurement test retained quantity=20 and requestedUnit=foot while selecting a pipe. Selection then produced needs_unit with quantity=null and requestedQuantity=20. Bare “2” did not mutate it; “2 pieces” explicitly produced the two-piece ₹490 demo review without another model call.

A live follow-up “How much for two PTFE tape rolls?” was misclassified by the model as an addition. Explicit English price intent is now read-only before inference. Variant-price buttons also retain quoted quantity/unit and cannot add a line; the user must press the separately labeled Add to my list action. Regression tests include a deliberately wrong provider classification and numeric-size preservation (1 inch stays a specification).

Final build/typecheck and **all 41 integration tests pass**. The tests run in isolated schemas with no actual model calls. Native order/correction and unit extraction were separately verified under the durable free-tier quota. Explicit quote verification below uses the native channel but needs no model call.

Final rebuilt browser check: “How much for two PTFE tape rolls?” returned the catalog’s ₹20/roll and ₹40 total in one photo envelope, leaving draft empty. Explicit Add to my list kept quantity 2; confirmation created one synthetic awaiting-shop-approval request. That complete quote/add/review/confirm path used three reply envelopes and zero model calls. No live WhatsApp/customer message or payment was sent. After the final wording-only rebuild, the browser was left on a fresh quote with an empty draft, ready for user testing; screenshot 008-quote-preview.png.
