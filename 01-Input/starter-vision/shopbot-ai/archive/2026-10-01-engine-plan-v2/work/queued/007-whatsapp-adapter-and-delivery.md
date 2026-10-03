# 007 — WhatsApp adapter and delivery

Status: queued. Dependencies: 002, 004, 005.

## Work

Implement supported Cloud API/provider adapter, raw signature handling, phone-number tenant routing, media fetch, durable ingress/send jobs, delivery status tracking, retry/reconciliation, and current messaging/rate configuration.

## Completion evidence

Replay-safe signed webhook fixtures; delivery failure recovery; provider schemas verified; live delivery marked pending without credentials; sent/delivered/billable counts remain separate.
