# Decisions — revision 3

2026-10-01. Detailed reasoning is in ARCHITECTURE-REVIEW.md.

## Confirmed by the user

Engine before onboarding; hardware trial with 50 SKUs; text/photo/voice; staff confirmation; MCP plus dashboard; export reportedly available; both usage billing and product payments; ₹10,000 setup + ₹1,000/month with AI additional.

## Revised technical baseline

| Decision | Why | Tradeoff / revisit |
| --- | --- | --- |
| @google/genai directly | Gemini-first runtime needs text/media and native structured/function interfaces | Provider-specific integration; reconsider AI SDK after a real second provider or UI requirement |
| Explicit business workflow controller | Most operations are known states/actions | We own routing/schema/context tests; do not build a general agent framework |
| One app + PostgreSQL | Low initial traffic does not establish a need for isolated processes | Split job worker when measured CPU/concurrency/restart needs justify it |
| pg-boss in the app | Durable jobs without a separate queue server or custom leasing code | Database contention must be measured |
| PostgreSQL + Drizzle | Related records, transactions, constraints, and shared store state | More setup than SQLite; preserved because multi-store reliability is part of the product |
| Zero/one-call routine path | Deterministic selections need no inference; open input can produce structured intent | Templates/profile coverage and extraction quality must be evaluated |
| Combined media evidence/intent | Avoid automatic second interpretation call | If quality falls, allow a bounded measured two-pass path |
| Target max two attempts per ordinary turn | Bound retries/follow-up cost | Configurable evaluation starting point, not a universal quality guarantee |
| Staged schema/UI modules | Deliver a working text/media bot before full administration/billing detail | All confirmed features stay in the roadmap |
| Better Auth and official MCP SDK at owner stage | Reuse authentication/protocol implementations | Selected MCP host's OAuth requirements still need verification |
| Hosted merchant payment links | Clear approved quote and external payment confirmation | Gateway credentials/fees/eligibility remain external requirements |
| Mock boot migrates/seeds automatically | Make local trial genuinely easy to run | Live mode must prohibit demo seeding |

Earlier two-container-process/AI SDK defaults are superseded. Archived instructions are inactive.

## Preserved correctness boundaries

Tenant/role authorization; exact variant clarification; customer media separated from owner writes; owner confirmation/version/audit; deterministic monetary arithmetic; idempotency/reconciliation; per-store metering; staff quote approval; signed payment verification.

## Open business/integration decisions

Actual languages, pricing/billing policy, support limits, provider/delivery fees, payment-account access, server capacity, selected MCP host, stock refresh/import schema, and profile fulfillment settings.

Exact stable SDK/model/API versions are selected and pinned in the first compatibility spike. Do not use a floating latest alias for production merely because a vendor sample does.
