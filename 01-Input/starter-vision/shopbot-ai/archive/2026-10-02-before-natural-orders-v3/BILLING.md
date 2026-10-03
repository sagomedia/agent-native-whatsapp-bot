# Two separate money systems

The user requested both store AI usage billing and customer product payments. They must have separate accounts, records, state transitions, and reports.

## A. Charging the store for AI usage

The quoted commercial structure is ₹10,000 setup and ₹1,000/month, with additional AI charges. The counting unit, markup/pass-through policy, retries policy, taxes, and treatment of WhatsApp charges remain open.

Implement metering from the first provider call:

1. Identify tenant, operation, run, provider, model, and rate version.
2. Estimate a bounded maximum request cost from known input limits, output limits, and applicable rate rules. Reserve budget atomically so concurrent jobs cannot each assume the same funds remain.
3. Submit through the metered provider adapter.
4. Capture actual provider usage and metadata, including billed reasoning/cached/modality units when relevant.
5. Calculate high-precision estimated provider cost; settle/release the budget reservation.
6. Store usage_event with actual/estimated/unknown status and a separate merchant-billable amount under a versioned billing policy.
7. Display store usage and produce deterministic monthly invoice lines.

A failed or retried call can still cost the provider. Record each attempt once. Do not automatically charge a store twice for internal retry overhead: the business policy must explicitly decide what is merchant-billable. Unknown provider usage needs reconciliation rather than pretending the cost is zero.

Only our backend's calls are in our AI ledger. An external owner AI host's own inference is billed by that host/account; an MCP tool calling our media/model adapter is our recorded usage.

## Published model candidate and pricing snapshot

Google's Gemini 3.1 Flash-Lite standard paid pricing, checked 2026-10-01: text/image/video input $0.25 per million tokens; audio input $0.50 per million tokens; output including thinking $1.50 per million tokens. Source: https://ai.google.dev/gemini-api/docs/pricing .

These rates are a seed snapshot for evaluation, not a permanent tariff or a quoted INR customer charge. Use actual provider usage and verify configured model/endpoint rates at integration. Audio is not priced using the cheaper text-input rate.

Illustrative formula without caching or other operations:

provider USD cost = text_image_input_tokens × 0.25 / 1,000,000 + audio_input_tokens × 0.50 / 1,000,000 + billed_output_tokens × 1.50 / 1,000,000.

For mixed-modality calls, record the provider's available modality usage. If only aggregate usage is returned, use a documented conservative estimate or a native adapter that exposes the needed details; flag estimates. Do not fabricate exact audio cost from a text-only counter.

Invoice INR conversion uses a recorded FX policy and rate. Provider cost and merchant bill are different columns. A customer turn can include one combined interpretation, an optional bounded follow-up, or retries; every attempt counts toward its limit.

## Other cost categories

Track WhatsApp sent/delivered/billable messages separately from AI calls. Delivery/provider rates require the actual account/provider and effective date; no message tariff is fixed here.

Track storage, hosting, gateway fees, and support separately. Monthly contribution must include these costs and avoid double-counting pass-through usage revenue.

Model calls run under supported API accounts. IDE allowances may help development/preparation, but are not the production billing mechanism.

## Billing collection

Build usage reporting and draft/final invoices first. Manual settlement can be recorded initially. Optional hosted payment links for platform invoices must use the platform's account, with references separate from merchant product payments.

The architecture supports collection links; automatic recurring debit/subscriptions and a prepaid wallet are deferred until their policies are agreed. Spend limits can be configured without implementing a stored-money wallet.

## B. Customers paying for products

Default adapter: Razorpay standard hosted Payment Links from the merchant's own connected account. Gateway handles the payment page and eligible payment methods. The bot sends the returned link; no card details pass through the agent.

Flow: customer request -> staff-approved quote -> payment link -> verified gateway status -> paid state -> staff fulfillment.

Use amount/currency from the immutable approved quote. Partial payments are disabled initially. Record link expiry. Quote changes require cancelling/expiring the old link and issuing a new version; a late payment on an old quote becomes an exception for review.

Do not assume stock reservation merely because a payment link exists. Staff must verify availability and use a short agreed quote validity. Reservation/live stock requires a later supported integration.

## Verification and reconciliation

Verify HMAC/signature against the raw body and the correct connection secret. Deduplicate events; webhook delivery may repeat or arrive out of order. Match merchant account, link/reference, approved amount/currency, and final paid/captured provider status. Fetch provider status when event content is insufficient.

A browser redirect, customer message, or uploaded payment screenshot cannot set paid=true. Keep acceptance, payment, and fulfillment distinct.

Persist an external-attempt record before creating a link. If response is lost, reconcile using the provider reference/status before creating another. Cancel/expired/failed/refunded states and charge exceptions are represented honestly.

Refunds use an explicit staff/admin operation and provider reconciliation. Do not let the model automatically refund or fulfill.

## Credential and account model

Store secret references, not plaintext API keys in agent-visible records. Local development uses environment/mock credentials. Hosted multi-store deployment uses a protected secret store or encrypted credential store with access scoped to the connection.

Merchant product-payment settlement is between the gateway and merchant under their account arrangement. Platform usage invoices belong to our separate platform billing account. Account eligibility, fees, and live activation remain to be checked.
