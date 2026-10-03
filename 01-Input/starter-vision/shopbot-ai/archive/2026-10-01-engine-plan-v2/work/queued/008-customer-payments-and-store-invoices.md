# 008 — Customer payments and store invoices

Status: queued. Dependencies: 002, 003, 006; 007 for live WhatsApp links.

## Work

Implement merchant test-mode Payment Links, immutable staff-approved quotes, expiry/version handling, signed/deduplicated events, amount/account validation, payment reconciliation, and separate usage invoices. Optional platform invoice links use a separate account.

## Completion evidence

No unapproved link; duplicate/out-of-order/mismatched/invalid events safe; no screenshot-based paid state; one logical invoice/charge; payment/acceptance/fulfillment distinct; actual gateway test needs credentials.
