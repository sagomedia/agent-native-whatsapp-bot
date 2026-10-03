# 002 — Domain state and permissions

Status: queued. Dependencies: 001.

## Work

Implement Drizzle schema/migrations, trusted tenant/actor context, membership checks, scoped repositories/RLS, durable ingress/outbox, conversations, catalog retrieval, carts, requests, and quote state.

## Completion evidence

Two stores remain isolated; variant/quantity validation and arithmetic work; duplicate events/submission are safe; state survives restart; staff approval is explicit.
