# WhatsApp, cart, and order requests

## Channel adapter

Start with a local conversation simulator, then connect the supported WhatsApp API/provider when credentials are available. Keep the channel transport separate from search and order logic.

Validate incoming webhooks, deduplicate event identifiers, handle media retrieval and delivery failures, and serialize or safely coordinate updates within each conversation. A retried event must not repeat cart additions or order submission.

Use the actual provider's current messaging rules and templates for notifications. Verify the applicable response window and billing behavior during integration; do not hardcode old claims that all service replies are free.

## Cart

Cart lines contain exact SKU, requested quantity, selling unit, and a price/source version. Recheck the catalog when producing the final request. If a material value changed, show the revised summary and let the customer review it.

The backend calculates totals and validates quantity precision. Availability is a dated snapshot unless live stock is actually connected. The trial does not reserve stock automatically.

## Order states

Use explicit states such as `submitted`, `needs_review`, `confirmed`, and `declined`. A submitted request is not a confirmed sale. Record the staff actor and time for confirmation or changes.

Submitting the same request twice must return the same result instead of creating two orders. Keep a durable order identifier, immutable submitted-line snapshot, and later staff changes in an audit trail.

Collect only details needed for the agreed fulfillment flow. Pickup/delivery coverage and required customer fields remain open.

## Staff handoff

Show staff the customer request, selected variants, quantities, price/stock timestamps, and unresolved questions. Staff confirm actual availability and fulfillment. Return a truthful status to the customer through the permitted channel flow.

## Trial boundary

Inbound assistance, approved product images, backend cart, and staff confirmation. No marketing broadcasts, payment collection, or automatic acceptance in the first release.
