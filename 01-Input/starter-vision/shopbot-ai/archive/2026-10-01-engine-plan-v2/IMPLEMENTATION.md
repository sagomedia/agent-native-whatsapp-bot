# Engine implementation roadmap

These are deliverables to build, not an already runnable application.

## Planned source layout

| Path | Implementation responsibility |
| --- | --- |
| apps/server/src/http/ | Fastify endpoints, authentication, webhook verification |
| apps/server/src/worker/ | Job dispatch, turn processing, outgoing events, reconciliation |
| apps/server/src/runtime/ | Trusted context, state machine, customer/owner agent definitions |
| apps/server/src/tools/ | Typed role-scoped wrappers over services |
| apps/server/src/services/ | Catalog, cart, quotes, changes, payments, billing |
| apps/server/src/adapters/ | Google model/media, mock providers, WhatsApp, Razorpay, storage |
| apps/server/src/db/ | Drizzle schema, migrations, repositories, tenant context |
| apps/dashboard/src/ | Simulator, owner chat, products/drafts, orders, usage |
| packages/contracts/ | Zod input/output/event/profile schemas |
| profiles/ | Validated hardware and second-retail profile configuration |
| tests/ | Meaningful state, permission, recovery, and provider-contract checks |
| deploy/ | Container build and production configuration guidance |

## Milestones

| Order | Work item | Observable result |
| --- | --- | --- |
| 1 | 001 foundation | Local API/worker/db/UI start; seeded stores and simulator |
| 2 | 002 services | Tenant-scoped catalog/state/cart/order services with deterministic tests |
| 3 | 003 metering | Budget-aware provider wrapper, usage records, cost display |
| 4 | 004 text agent | Bounded typed tool loop and persistent clarification |
| 5 | 005 media | Image/voice attachments, normalization, and proper record effects |
| 6 | 006 owner tools | Dashboard/MCP drafts and confirmed changes |
| 7 | 007 WhatsApp | Durable verified live-channel adapter and outgoing delivery |
| 8 | 008 payments/billing | Staff-approved links, verified events, usage invoices |
| 9 | 009 profiles/onboarding | Configure another store without forking runtime |
| 10 | 010 evaluation | Fresh setup, crash/retry, isolation, cost, and real-store evidence |

Dashboard skeleton begins in milestone 1, catalog views grow with services, and owner conversations arrive in milestone 6. Usage capture is available before real agent calls.

## Required local commands

The implemented repository must supply and verify:

- cp .env.example .env
- docker compose up --build
- docker compose run --rm api npm run db:migrate
- docker compose run --rm api npm run db:seed
- npm run test:integration

Decide and document whether first boot applies migrations/seeds automatically. Seeds must be idempotent and restricted to demo mode. Never seed demo owners/catalog into a live store.

Default mock mode needs no AI/WhatsApp/payment keys. It exercises contracts/state/UI, not real language or photo understanding. Live mode requires explicit credentials and authorized test spend.

## Configuration contract

Supply a documented .env.example with database, auth secret/base URL, mock/live flags, model IDs, adapter settings, media limits, agent budgets, channel secrets, payment test/live mode, and storage settings. Secrets are empty placeholders, not populated artifacts.

Suggested configurable starting targets: 3 agent model steps; 4 total provider calls per turn; 300 output tokens for routine replies; 5 catalog candidates; 60-second voice notes; 5 MB image upload limit; 10 MB audio upload limit; 6–10 recent messages. They are initial product limits to evaluate, not provider maximums. Preserve enough image detail to read labels. Handle larger/longer inputs with an explicit fallback.

Spend caps default to disabled paid calls in mock mode. Production requires an explicit cap/policy and a configured rate source.

## Live deployment

Deploy the same API/worker image and PostgreSQL on the user's available server with HTTPS, persistent media or object storage, database/media backup, protected credentials, and health/readiness checks. Expose public provider webhooks and authenticated owner routes; database remains private.

The chosen SDK does not require Vercel hosting. Start with one store and bounded concurrency; measure capacity before adding many stores. Actual existing server resources and deployment constraints are still unknown.

## Integration checkpoints

- Package/API compatibility and stable model identifier verified during the first provider spike.
- Real text/image/audio requests record actual usage.
- Owner sessions and the selected MCP host/auth flow are tested separately.
- WhatsApp and payment webhook raw-body signature paths preserve raw bytes.
- Payment tests run in gateway test mode before live use.
- Data import compatibility and hardware matching are tested only after actual client inputs arrive.
