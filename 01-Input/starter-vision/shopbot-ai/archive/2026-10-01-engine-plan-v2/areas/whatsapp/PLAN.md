# Channel and order services

Primary specifications: RUNTIME-FLOWS.md, DATA-MODEL.md, BILLING.md.

Build the local simulator and normalized channel contract first. WhatsApp adapter verifies ingress, resolves its configured phone number to a tenant, fetches authorized media, and records provider/delivery identifiers.

Persist verified ingress and durable work intent before acknowledging. Deduplicate inbound/outgoing business effects. Use a durable outbox and reconcile uncertain delivery rather than promise exactly-once external sends.

Cart/order/quote services use exact SKUs, deterministic arithmetic, source versions, and explicit review. Staff approval precedes payment-link issuance. Acceptance, payment, and fulfillment are independent.

Use the actual current provider messaging rules and rate configuration at integration; inbound focus does not establish zero delivery cost.
