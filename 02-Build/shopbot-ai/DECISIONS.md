# Foundation decisions

2 October 2026. These are local implementation choices, not commercial commitments.

| Choice | Requirement / simplest alternative | Cost and revisit condition |
| --- | --- | --- |
| TypeScript + Fastify + Zod | Typed operation contracts and a small HTTP surface; native HTTP would duplicate validation/error handling | Dependency updates; revisit only for an existing server integration |
| PostgreSQL + Drizzle | Durable transactional drafts/messages; direct SQL is used for visible versioned migration and locks | Local database setup and schema maintenance; evolve migrations by feature |
| pg-boss in the app | Restart-safe jobs without a second broker; in-memory tasks lose work | PostgreSQL job schema/housekeeping; split workers after measured contention |
| Durable inbox as work authority | Commit/enqueue gaps recover by scanning pending rows and creating wake jobs | Short polling in mock mode; live ingress gets retry/error/outbox policy in its milestone |
| React + Vite | Small simulator with inspectable catalog/chat/draft; plain HTML is possible | Build dependency/toolchain; owner UI can reuse the shell later |
| Fixed mock identity | No owner authentication needed to test synthetic state; client-provided actor/store is rejected | Local-only surface; replace with verified channel/owner identity before real records |
| Delay provider SDK/auth/MCP/payment libraries | None are executed in the local foundation | Add with their milestone and compatible pinned versions, authorization and tests |

Stable package versions were read from the npm registry and pinned in package.json/package-lock.json. Node 22.22.1 and PostgreSQL 17.6 images are pinned. No AI model or WhatsApp API version is selected yet.

API references consulted: [Fastify](https://fastify.dev/docs/latest/Guides/Getting-Started/), [Drizzle PostgreSQL](https://orm.drizzle.team/docs/get-started-postgresql), [Vite](https://vite.dev/guide/). Installed pg-boss type declarations verified queue/worker APIs against the pinned version.

Quantity steps now come from product metadata; the reusable tools validate up to three decimal places and round line totals half-up to paise. Mock IDs are fixed server-side. Full tenant roles, database access policies and isolation are required before multi-store hosting; this foundation does not claim them.

## Agent tool core decisions

- Shared service tools are the business boundary; the simulator and future native/WhatsApp/MCP adapters reuse them. Product fixtures are data, not core logic.
- The interpreter proposes strict operations. Explicit submission consent is supplied only by trusted deterministic channel handling, outside model arguments.
- Reviews expire in 15 minutes and bind version/hash; customer requests preserve immutable price/line snapshots. Physical readiness/payment stay separate.
- A 30-second work lease and at most two persisted attempts prevent unbounded recovery. Mock attempts cost zero; live adapters are disabled pending paid accounting.
- No general agent framework/SDK dependency is needed for the local mock core. Choose and verify the native provider separately.
- One submitted request per conversation is an initial lifecycle constraint; amendments/new requests need explicit future design.

## Native adapter decisions

- Pin the official Google SDK 2.26.0; use gemini-3.5-flash-lite as an evaluation candidate, standard tier/minimal thinking with structured operations. Native quality is not inferred from mocks.
- Explicitly disable SDK retries/automatic tool calls; one paid invocation belongs to one persisted attempt.
- USD accounting stays separate from product paise; no implicit exchange rate or invoice claim.
- Reserve a conservative full-input-limit/output-cap amount before invocation, then settle consistent usage. Unknown costs stay held, and store budgets span conversations/repeated evaluations.
- Keep native evaluation in an explicit local CLI with synthetic fixtures; no unauthenticated paid simulator endpoint.
