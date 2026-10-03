# 004 — WhatsApp delivery

Status: queued. Dependencies: 002, 003.

## Work

Add supported signed channel adapter, number/store routing, media fetch, durable ingress/outbox, delivery states and provider schema/rate configuration.

## Completion evidence

Duplicate/crash/retry fixtures pass; live delivery separately verified with credentials; API/job contention measured before worker split.
