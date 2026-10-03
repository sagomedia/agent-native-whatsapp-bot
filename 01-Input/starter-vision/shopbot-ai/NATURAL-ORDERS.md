# Natural conversation and multi-item orders

Revision 4, 2026-10-02. Required engine behavior; not implemented. The customer website remains a scripted illustration.

## What the customer experiences

A customer describes a shopping list naturally, in one text message or voice note, and can refer to previously uploaded photos. The bot resolves the complete list, remembers clear items while clarifying unclear ones, offers a combined summary, and understands short contextual replies and corrections.

Example request:

> I need three half-inch PVC elbows, two PTFE tape rolls and one ten-inch adjustable wrench. I will collect them from the shop.

Expected conversation:

1. Resolve all three lines together against this store's catalog. Ask only for genuinely missing specifications or product choices.
2. Show the three exact products, quantities, units, authoritative prices, total, pickup method and any unresolved availability. Ask: "Shall I send this order request to the shop?"
3. Customer says "yes". Submit that exact reviewed snapshot once; reply with the order reference and "Waiting for the shop to confirm."
4. Staff accepts availability/quote. Changed price, quantity or substitute requires a new customer review before commitment/payment.
5. Apply the store's payment policy. Prepaid orders wait for verified payment before releasing a packing task. An explicitly enabled pay-at-store policy can release it after acceptance.
6. Staff starts packing and later marks ready. The bot sends the corresponding true status, pickup reference, configured shop address and directions/location.
7. Staff records collection. Payment, acceptance and fulfillment remain separate.

The bot can coordinate packing work; the shop physically packs the order. A customer's "yes" cannot prove that packing has happened or override staff approval.

## Supported conversation behavior

| Input | Required result |
| --- | --- |
| Three to five distinct items in one message | Extract and resolve every line; do not handle only the first item |
| "Add two tape rolls and change the elbows to five" | Stage both operations against the existing cart; produce one revised summary |
| "Remove the wrench; keep everything else" | Remove that exact line and preserve all other lines |
| "The second one" | Resolve against the last displayed, versioned candidate list; ask when unclear |
| "Same size as before" | Use established size for the relevant family; do not infer sizes across unrelated products |
| "Yes" following one order summary | Confirm only the current, unexpired summary bound to this customer/conversation |
| "Yes, but make the elbows five" | Apply the edit and ask for confirmation of the new summary |
| "Three or four elbows" | Ask for an exact quantity |
| One unavailable or uncertain item | Retain the other lines and ask about this item; no silent omission/substitution |
| Text followed by voice/photo | Continue the same draft and link evidence to the correct line; ask which item if needed |
| Price request without purchase intent | Answer from catalog facts; do not create a committed order |
| Customer changes an already submitted order | Create an explicit amendment request; do not silently rewrite an accepted/paid order |

Multiple items are normal behavior, not an exceptional agent mode. Real language coverage, including Tamil/English code-switching, requires evaluation.

## Interpretation contract

Extend the single-action/selected-SKU contract to a typed batch of proposed operations plus persistent draft lines. The model produces proposals, not trusted database identifiers or business facts.

Illustrative shape, to be formalized with Zod:

```json
{
  "operations": [
    {"kind":"add_item","rawText":"three half-inch PVC elbows","category":"PVC elbow","quantity":"3","unit":"piece","specifications":{"size":"1/2 inch"}},
    {"kind":"add_item","rawText":"two PTFE tape rolls","category":"PTFE tape","quantity":"2","unit":"roll","specifications":{}},
    {"kind":"add_item","rawText":"one ten-inch adjustable wrench","category":"adjustable wrench","quantity":"1","unit":"piece","specifications":{"size":"10 inch"}},
    {"kind":"set_fulfillment","method":"pickup"}
  ],
  "requestedNextAction":"review_order",
  "uncertainties":[]
}
```

Server-derived tenant, role, actor, draft/version, source-event IDs and line IDs stay outside model authority. The service resolves customer references and product candidates in the correct store. Allowed operations include add, set quantity, remove, select candidate, set fulfillment, ask price/status, request review and request confirmation. Validate units, quantities, action dependencies and role permissions.

Initial ordinary-turn limit: ten distinct requested lines and a bounded operation array. Three to five lines are mandatory acceptance cases. Over-limit input produces an explicit split/review request; never silently truncate. Preserve original evidence. Increase limits only with measured quality, latency and cost.

## Batch execution without a large agent framework

1. Persist the input and load the current structured draft, relevant recent context and pending question.
2. Interpret all requested operations in one structured model call where reliable. Known button/ID actions and an unambiguous standalone confirmation can bypass inference.
3. Validate the batch; identify dependencies. Resolve all mentioned products using batched/bounded catalog queries. Independent lookups may run concurrently without increasing model calls per item.
4. Give each draft line a stable ID and resolution state: unresolved, needs specification, needs candidate choice, matched or unavailable. Keep quantity/unit, source evidence, proposed SKU and ambiguities.
5. Apply valid draft changes together in a version-checked transaction. If an operation is invalid or conflicts, retain the original draft and explain the unresolved proposal. Saving unresolved draft lines is allowed; submitting them as purchased products is not.
6. Ask a concise grouped question for missing details. When several replies would be confusing, ask one targeted question at a time while preserving all other resolved lines.
7. When all included lines are resolved, validate prices/availability and generate a summary from service facts. Unknown stock requires staff confirmation; it is not reported as available.
8. Bind confirmation to that exact snapshot. Create one idempotent order request only after customer consent, then hand it to staff.

A draft is not a committed order. Confirmed cart writes may contain only matched SKUs; unresolved requests stay in draft lines. A customer may explicitly approve a resolved subset, with the omitted lines clearly listed. Do not silently proceed with a partial list.

Use the existing native Google adapter/controller. No discovery/planning/matching agent chain is needed for each item. Optional bounded native tool continuation remains available for genuinely unresolved cases.

## Context and confirmation

Persist draft version, stable line IDs, current question, candidate-list version, fulfillment choice, summary/proposal ID and confirmed order reference. "Yes" means the answer to the pending question, not an unconditional checkout command.

The pending confirmation includes customer/conversation identity, purpose, cart/draft version, immutable summary hash, pricing/source versions, expiry and consumed state. Any cart edit, contradictory reply, replacement quote or expired proposal invalidates it. Duplicate delivery of "yes" must not create two orders.

Do not use zero-call affirmation handling for compound replies such as "yes but change…", replies to an unrelated question, or multiple simultaneous proposals. Interpret or clarify these within the existing attempt budget.

If stock/price checks fail or change after the preview, produce a new summary and require consent where the customer's commitment changes. In manual mode, a customer-confirmed snapshot becomes a request rather than a stock reservation guarantee.

## Shop workflow and pickup

Default remains staff approval. The dashboard/MCP services expose a picking list containing exact SKU/specification, quantity/unit, order reference, payment/acceptance status and pickup instructions.

Fulfillment states: awaiting approval → queued for packing → packing → ready for pickup → collected. Support rejection/cancellation/review states explicitly. Acceptance and payment are separate fields with transactional transition guards; do not combine them into one overloaded status.

Only authenticated staff actions or a verified fulfillment-system integration may mark packing/ready/collected. A timer, customer confirmation, payment event or model prediction cannot mark ready. ETA is staff-supplied or absent.

For stores that later request automatic acceptance, add an explicit owner-enabled policy gated by reliable stock, source freshness, supported items, reservation/concurrency checks and operational capacity. This is a later optional capability, not the baseline promise. Physical readiness still requires a real shop event.

Store pickup settings hold verified display name, address, latitude/longitude, map link, opening hours, contact and payment policy. The model does not invent an address, coordinates or collection time. Missing location settings block sending claimed directions and create an owner setup task.

Send a readiness message only after the real ready event. Example: "Order #1042 is ready for pickup. Bring this order reference. [Shop address / directions]." The channel adapter chooses a supported location message or verified map link. Preserve readiness even if message delivery fails; track/retry delivery separately.

Readiness may occur after the active reply window. Add delivery-time eligibility checks and approved transactional templates where required; account for applicable delivery costs separately from model costs. These are order updates; the initial scope still has no marketing broadcasts.

## Affordability

Target one interpretation for a whole ordinary shopping-list message, not one model call per product. Preserve the initial two-attempt ceiling including retries/optional follow-up. Use batched search services and short relevant structured state.

Output budgets must fit the permitted operation/line count, transcript and uncertainty fields; detect truncation and reject partial actions. Do not remove needed detail merely to keep the earlier single-item output cap.

Routine totals, confirmation, staff status and configured pickup location use services/templates. The cost/quality of multi-item extraction remains a measurement, not a proven saving.

## Build placement

- Slice 001: fixtures/simulator contain at least five distinct sellable products and stable draft line state.
- Slice 002: batch text extraction, references/corrections, multi-line resolution, versioned summary/confirmation and idempotent requests.
- Slice 003: the same contract from voice/photos; evidence association and uncertainty clarification.
- Slice 004: channel rendering within actual WhatsApp capabilities, pickup/location messages and delivery-time eligibility/template handling.
- Slice 005: staff picking queue, acceptance/amendment review and real packing/ready/collected actions through shared dashboard/MCP services.
- Slice 006: approved quote/payment policy gating without conflating paid and ready.
- Slice 008: full natural-order acceptance suite and live quality/cost checks.

## Required acceptance cases

1. One text message requests five different SKUs with different quantities/units; all five are preserved and summarized correctly.
2. Voice requests three items in mixed Tamil/English; uncertain size/numbers are clarified; no missing or fabricated line.
3. Four items are clear and one is ambiguous; clarify only the fifth while retaining the other four.
4. Customer changes one quantity, removes another line and requests pickup in one message; the new draft matches every instruction.
5. "Yes" commits one current summary once; duplicate, stale, unrelated and "yes but change" replies cannot confirm the wrong order.
6. Stock/price changes and substitutions trigger an explicit new review; no silent acceptance.
7. Staff rejects one line; alternatives or a reduced order require customer consent.
8. Prepaid packing remains blocked until verified payment; enabled pay-at-store orders follow the configured policy.
9. Customer confirmation/payment cannot mark ready. Staff ready action triggers pickup reference plus configured location.
10. Crash/replay and two concurrent messages do not lose lines, duplicate orders or mix confirmations. Tenant isolation holds throughout.
11. Over-limit/truncated interpretation cannot silently apply a partial list.
12. Readiness after the reply window uses an eligible transactional delivery path or reports delivery pending; it is not sent through an invalid free-form path.

Record mock correctness, authorized real-model extraction, real-channel delivery and real-store staff usefulness separately. The current prototype proves none of these live capabilities.

## Channel references checked 2026-10-02

- Meta's utility-message overview describes order confirmation/update/cancellation notifications: https://business.whatsapp.com/products/conversation-categories/utility
- Meta's WhatsApp Cloud API collection exposes sending location messages: https://www.postman.com/meta/whatsapp-business-platform/request/3pwqfn8/send-location-message
- Recheck current channel eligibility, template approval and pricing in slice 004 before real delivery; no universal free-notification promise is made here.
