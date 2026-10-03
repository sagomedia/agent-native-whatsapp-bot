# Engine acceptance evaluation

Run these after implementation. Nothing in this checklist has passed yet.

## Foundation

- Clean setup starts API, worker, PostgreSQL, dashboard, and simulator using documented commands.
- No provider credentials required in mock mode.
- Restart preserves conversations, cart, proposals, orders, jobs, and media.
- Demo seed/reset cannot run against a live store accidentally.

## Runtime and permissions

- Two stores with overlapping SKU names/IDs remain isolated.
- Customer tools cannot perform owner edits or see another customer's order.
- Role/profile configuration changes the permitted tool set and variant questions.
- Exact buttons/IDs use deterministic services where appropriate.
- Ambiguous variants require clarification before cart insertion.
- Agent step/call/token budgets and fallback are exercised.

## Media and writes

- Customer image -> attachment/analysis only.
- Owner image -> draft/proposal; no publish until reviewed.
- Voice -> saved transcript -> same intent/tool flow.
- Unclear voice number or target requires clarification.
- Confirmed owner price/stock edit creates one versioned, audited change.
- Stale/expired/replayed confirmation cannot silently apply.

## Metering and recovery

- Each actual provider attempt creates one usage record.
- Text/image/audio rates are applied to their applicable measured units.
- Concurrent budget reservations enforce the store cap.
- Unknown timeout usage is retained for reconciliation.
- Duplicate jobs do not duplicate logical charges, cart changes, or orders.
- Outgoing events recover after crash; uncertain provider effects reconcile.

## Payments

- No link before staff approval of an immutable quote.
- Amount/currency/account/reference mismatch cannot mark paid.
- Invalid signatures and screenshot/redirect claims cannot mark paid.
- Duplicate/out-of-order paid/authorized events preserve valid state.
- Expired/replaced quote payments enter explicit review.
- Payment, order acceptance, and fulfillment remain distinct.
- Platform invoices and merchant product payments stay separate.

## Evidence levels

Mock integration tests prove services and state behavior. Real API smoke tests prove adapter compatibility and usage capture. Fresh hardware photos/voice notes prove matching quality. A merchant pilot evaluates value and support. Report these separately.
