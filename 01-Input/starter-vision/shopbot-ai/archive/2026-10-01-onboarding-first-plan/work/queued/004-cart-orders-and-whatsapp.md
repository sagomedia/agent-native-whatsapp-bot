# 004 — Cart, order requests, and WhatsApp

Status: queued. Dependencies: 002; photo/voice coverage additionally uses 003.

## Work

Build SKU-specific cart operations and staff-confirmed order state transitions. Start with a conversation simulator; add a supported WhatsApp adapter when credentials exist. Handle repeated events and price changes explicitly.

## Completion evidence

- Quantity precision, units, totals, and source price versions are preserved.
- Duplicate webhook/submission produces one cart effect/order.
- Staff confirmation is required; stock is not automatically reserved.
- Customer receives accurate submitted/confirmed/declined status.
- Live delivery evidence is distinguished from simulated-channel checks.

Verify current provider documentation and charge configuration during real integration.
