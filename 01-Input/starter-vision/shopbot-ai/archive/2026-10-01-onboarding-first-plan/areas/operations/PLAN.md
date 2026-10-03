# Costs, reliability, and repeatability

## Usage ledger

For each provider request, record store, conversation/job, operation, model/version, actual billable usage, retry relationship, and outcome. Track catalog preparation separately from customer runtime.

Keep AI requests, customer turns, sent messages, and delivered/billable WhatsApp messages as separate counters. One customer turn can trigger several model requests or outgoing messages.

Use dated price configuration and actual invoices to reconcile estimates. Include applicable currency conversion and taxes separately. Do not describe estimated cost as an invoiced charge.

## Commercial measurement

The quoted setup fee is ₹10,000. Record human hours for export cleanup, photography, classification review, customization, and deployment. Use the user's chosen value per hour to judge whether setup is repeatable.

The monthly service fee is ₹1,000, with AI charges additional. Treatment of WhatsApp/provider charges and support allowances is not decided. Measure them before making a margin claim.

Monthly contribution before fixed business overhead = service revenue + collected usage fees − provider/AI charges paid − storage/hosting costs − recurring support labor − other direct costs. Avoid double-counting usage fees when they are pass-through reimbursements.

Free server capacity is the current assumption, not a permanent scaling guarantee. No production dependency should rely on an IDE's interactive subscription allowance without a supported deployment/billing arrangement.

## Reliability

Persist catalog, conversation/cart, orders, and usage. Provide database backup/recovery appropriate to the trial environment. Avoid a complex distributed architecture until evidence calls for it.

Use bounded retries, provider timeout handling, idempotent events, and clear fallback messages. If photo/voice processing fails, preserve the order/cart state and offer text or staff help.

Rate limits and spend caps should produce a recoverable fallback rather than an invented answer or silent failure. Do not disable all shop functionality merely because one AI provider is unavailable.

## Repeatability

Keep store configuration separate from reusable product logic. Carry a store identifier in domain records so later expansion does not require rewriting the data model; operate one store first.

Measure how much of the next store's setup can use the same importer, backend, owner tools, and evaluation process. This is evidence for the business model, alongside sales and support results.
