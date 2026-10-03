# Reviewed engine evaluation

No tests have run; implement then record evidence.

## Startup and persistence

Clean mock first boot brings up app/PostgreSQL, migration/seed, dashboard and simulator. Readiness gates setup. Reboot preserves cart/state/media/jobs. Live seed/reset is refused.

## Controlled workflow

Known ID/button/proposal confirmation requires zero model calls. Ordinary interpretation targets one. All attempts/retries follow the cap and budget. Invalid/truncated schema cannot mutate records. Relevant context is bounded.

Two stores/roles cannot cross-read/write. Ambiguous variants clarify. Products/prices/totals come from services. Optional native function continuation preserves correct history/IDs/signatures.

## Media quality and accounting

Customer upload -> attachment/analysis; owner upload -> draft/proposal. Compare combined versus two-pass extraction on held-out images/voice names/numbers. Report actual total calls/tokens/cost and failures.

Reused observations cannot reuse stale context-specific intent. Voice output limits fit transcript/schema and truncation is detected. Owner target/amount uncertainty clarifies; stale/replayed confirmation cannot apply.

## Recovery and money

Durable event/job/outgoing handling survives crash/replay. Per-conversation state transitions remain valid. Usage attempts are unique; provider cost/billable amount separate; modality/unknown/cached/thinking fields correctly handled.

Payment link requires approved quote. Invalid/duplicate/out-of-order/mismatched/old-quote events preserve valid state. Screenshot/redirect cannot set paid. Acceptance/payment/fulfillment remain distinct.

## Evidence gates

Compare latency and cost per useful completed conversation, plus worst/high-cost cases and staff support, rather than only token tariffs. Worker split, embeddings, bigger models, AI SDK/provider abstractions and extra schema tables require measured needs.

Report mock/state tests, live SDK/channel/payment smoke tests, real hardware quality and merchant commercial outcomes separately. No SDK savings or capacity claim from design alone.
