# Bounded WhatsApp runtime

Implemented locally on 17 October 2026. No deployment, live quota change, paid-budget increase or provider request was performed for this work.

## Behavior

`startWhatsAppJobs` now runs independent bounded pools for planning, media decoding/download, and outbound delivery, plus one reconciliation worker. Each slot starts at most one operation at a time; the production polling interval remains one second. Shutdown prevents new ticks and awaits all active operations before the database pool closes.

| Environment setting | Default | Allowed values |
| --- | --- | --- |
| `WHATSAPP_PLANNING_WORKERS` | 1 | Integer 1–10 |
| `WHATSAPP_MEDIA_WORKERS` | 1 | Integer 1–2 |
| `WHATSAPP_OUTBOUND_WORKERS` | 1 | Integer 1–2 |

These settings are parsed through the existing WhatsApp configuration used by `readConfig`. Configurations constructed directly in code receive the same default bounds and startup validation. The example environment retains one worker for every stage. The current five-recipient channel configuration limit remains unchanged; the ten-chat test uses synthetic recipients in a directly constructed isolated fixture.

The planning selector considers only the oldest unfinished message in each conversation and skips active processing leases, future retries and pending media. A bounded candidate batch and local in-flight set let concurrent slots choose different conversations. The existing runtime transaction locks, claim tokens, processing leases, original turn deadlines, provider attempts and budget/quota reservations remain authoritative across processes and restarts. A local set is never used as a replacement for a durable claim.

Media workers decode only the oldest unfinished input in a conversation. A slow media turn therefore holds its own conversation in order while independent planning and delivery workers continue. Direct `channel.processNext()` calls retain their previous convenience behavior of trying one media item first; scheduled planners use `skipMedia` because the scheduler owns a separate media pool.

Outbound claims retain the existing invoice-page delivery gate and now also wait behind an earlier queued, sending or unknown reply in the same conversation and operator revision. Independent chats remain eligible. An ambiguous send is never automatically resent; durable callbacks can reconcile it and release later replies. Existing owner-control revisions, approved recipients, service-window checks, bounded rate-limit retries and authentication blocking remain enforced.

The worker count changes scheduling capacity only. It grants no additional inference budget or provider quota. With five workers and one affordable paid reservation, the admission test makes exactly one offline provider-double call. The corresponding shared free-quota test also makes exactly one call under the existing minimum spacing policy.

## Verification

Validation result: `npm run typecheck` passed. The targeted runtime, WhatsApp, inventory, customer-experience and inference-admission run passed all 71 tests in 29.5 seconds, including all 11 dedicated concurrency tests.

The dedicated `tests/whatsapp-concurrency.test.ts` covers:

- One, five and ten simultaneously held independent mock-provider conversations; observed planning concurrency reaches the configured count without exceeding it.
- A slow first turn and a queued second turn in one conversation while an independent chat completes; another channel instance respects the durable active lease.
- Pending-media and delayed-retry heads cannot let a later same-chat message overtake them or starve an independent chat.
- Restart honors an active lease, recovers an expired lease and preserves duplicate-webhook/reply idempotency.
- Independent bounded media, outbound and reconciliation slots; shutdown drains held work and stops new sends.
- Concurrent outbound sends remain ordered within a chat while another chat sends; an unknown attempt waits for reconciliation.
- Five-worker shared free-quota and paid-reservation admission using offline provider doubles.

All integration fixtures require an explicit `DATABASE_URL`, create their own PostgreSQL schema and drop it after completion. The test database used was the isolated local instance on port 55442. Tests never use application schema state or external provider/network calls.

Reproduce from `02-Build/shopbot-ai` with an explicitly supplied isolated database:

```sh
npm run typecheck
node --import tsx --test --test-concurrency=4 tests/whatsapp-concurrency.test.ts tests/whatsapp.test.ts tests/inventory-flow.test.ts tests/customer-experience.test.ts tests/inference-admission.test.ts
```

## Release and practical limits

Return planning concurrency to one to restore the conservative scheduling default; media and outbound defaults are also one. The durable schema, queue records and committed shopping transactions require no rollback for a worker-count change. Existing process/send/AI/media flags retain their separate authorization gates.

The bounds apply per application process. Multiple processes share durable claims and quotas but add their configured resource slots; coordinate replica count during rollout. PostgreSQL's application pool remains bounded at ten connections. The maximum worker settings can queue for those connections and must be assessed against real database, decoder, renderer and provider headroom before rollout.

This is a scheduling and correctness test, not a real-provider latency, Tamil-recognition accuracy, VPS capacity or end-to-end service-level measurement. The ten-chat test does not demonstrate ten simultaneous live model calls under today's quotas. A merchant-approved canary and measured real-device latency remain release work.
