# Reviewed runtime flows

Specifications only. Persist user evidence and business effects separately.

## Shared interpretation output

NormalizedInput/Interpretation includes request/event IDs, trusted context supplied by the server, requested action, extracted slots, transcript/image observations when present, ambiguous fields, and evidence references.

The model cannot authenticate identity or authorize a mutation. Validate the returned schema before calling a service.

## Customer text

1. Verify/store the event and schedule durable processing.
2. Resolve an exact known action directly if possible.
3. Otherwise make one metered structured interpretation request with current conversation/profile.
4. Controller searches the catalog, resolves missing specifications, or invokes an authorized action.
5. Render questions, candidate facts and totals from services/templates.
6. Persist state and outgoing intent; deliver and track status.

Ordinary result wording does not automatically require a second model call.

## Customer photo

1. Authorized channel adapter downloads media; app validates size/type and saves bytes plus attachment metadata.
2. One structured vision request attempts to return observations and request intent together.
3. Save observations/analysis version and usage; validate intent.
4. Search bounded catalog candidates from observed labels/specifications/category.
5. Ask a missing size/thread/material question or show reviewed candidates.
6. Optional second bounded comparison is evaluated only if necessary.

Products, stock, and prices do not change from a customer upload.

Cache reusable observations by tenant/purpose/asset/model/analysis version. Cache request-specific interpretation only with its request/context versions. Reusing an image for a different request must not reuse stale intent.

If category/text evidence cannot retrieve useful loose items, evaluate candidate comparison or multimodal embeddings. Do not call baseline photo retrieval proven until held-out real photos pass.

## Customer voice

1. Save validated audio and its duration/type.
2. Use a single native audio request to produce transcript plus structured intent/specification slots where quality permits.
3. Persist transcript/evidence and usage.
4. Controller invokes the same search/cart flow without automatically sending the transcript to another model.
5. Clarify uncertain numbers/product names. Use a two-pass fallback only when measured quality warrants its extra cost and fits the attempt budget.

Preserve supported OGG/Opus; use bounded conversion only when needed. Output limits must fit transcript plus schema; detect truncation.

Asynchronous voice notes are required. Realtime calls and synthesized replies are deferred.

## Owner photo

Authenticated upload creates a draft-purpose asset and proposed product/image fields. Owner reviews exact mapping and missing authoritative fields before publishing/applying. The same services support dashboard and MCP asset-ID workflow.

No inferred price/stock from an image or online listing becomes an inventory fact. Customer images and owner-approved catalog images have different retention/visibility policies.

## Owner voice change

Example: Change HW-014 price to 120 rupees. This is hypothetical.

1. Authenticate owner before interpretation.
2. One audio request produces transcript and proposed operation; uncertain target/amount triggers clarification.
3. Service resolves the SKU in the owner's store and creates a proposal with current value, 12000 paise, expected version, actor, and expiry.
4. Show before/after; owner explicitly confirms that proposal.
5. Confirmation bypasses the model. Service validates actor, field, source policy, expiry, version and idempotency.
6. Transaction writes the versioned change plus audit, then invalidates relevant catalog caches.

A bare yes needs a secure binding to one pending proposal. A stale record requires another preview.

## MCP

External host selects owner tools and sends authenticated requests. Server invokes shared services directly; it does not add a backend model call just to restate the host decision.

Backend media analysis requested through a tool is metered. Attachment forwarding depends on host support; provide dashboard upload and an asset-ID interface.

## Payments

Customer request -> staff-approved immutable quote -> merchant payment link -> verified gateway state -> payment update -> staff fulfillment.

Create the link from the stored quote/account, not a generated amount. Verify raw signatures, deduplicate events, match amount/currency/account/reference, and reconcile provider status if ambiguous. Reject screenshot/redirect as payment authority.

Acceptance, payment and fulfillment are separate. Old/expired quote payment and inability to fulfill produce explicit review/refund state.

## Recovery

Every real provider attempt is recorded. Unknown timeout outcome is reconciled rather than silently replayed or billed as known usage. Logical cart/proposal/order/payment effects remain idempotent.

Persisted state survives restart. Budget exhaustion and failed media preserve cart/order state and offer clarification/text/staff help.

## Natural multi-item orders and fulfillment — revision 4

Apply NATURAL-ORDERS.md to text, voice and contextual photo requests. Interpretation returns operations[] and item-specific uncertainties, not only one selected product/action. Resolve all lines, retain clear lines during clarification, and show a complete immutable review snapshot. Contextual yes consumes one unexpired confirmation bound to actor, conversation and draft/version; yes with an edit creates a new review.

Customer confirms -> idempotent request -> staff accepts quote/availability -> payment-policy gate -> staff packing -> staff ready -> pickup reference and configured store location -> staff collected. Changed products/prices/quantities require renewed customer consent. An unresolved line is not silently omitted. Real packing/ready events originate in authenticated shop actions or a verified fulfillment integration.

Keep outbound readiness delivery separate from fulfillment state, including retries and delivery-time channel/template eligibility. No model-created address, unsupported pickup promise or automatic physical packing claim.
