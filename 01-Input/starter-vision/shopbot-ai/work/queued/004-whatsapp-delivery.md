# 004 — WhatsApp delivery

Status: queued. Dependencies: 002, 003.

## Work

Add supported signed channel adapter, number/store routing, media fetch, durable ingress/outbox, delivery states and provider schema/rate configuration.

## Completion evidence

Duplicate/crash/retry fixtures pass; live delivery separately verified with credentials; API/job contention measured before worker split.

## Natural-order scope

Implement NATURAL-ORDERS.md pickup/status delivery with configured verified address/location, actual channel controls and delivery-time eligibility/transactional-template handling. Ready messages require a real staff/integration ready event.
