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

## 3 October 2026 — indexed catalog and voice

Catalog taxonomy is tenant-owned data. The backend uses indexed retrieval and real facets; AI plans keywords rather than receiving all variants. Related products are labelled, hard filters remain hard, and relevance scores are not displayed as probabilities.

Normalized voice notes use bounded PostgreSQL bytea storage in this local phase, transactionally scoped alongside durable events. This keeps retries, ownership and playback consistent without a second filesystem commit. The existing media volume remains for future channel/merchant media; a production media-retention/object-storage policy is a later deployment decision.

Recorded voice uses one free-only transcription/planning request. The paid text rate profile does not authorize audio. Photo acceptance and final submission remain separate deterministic consent actions.

Provider compatibility: the live endpoint rejected the expanded generation grammar. Use JSON mode with the compact contract in the instruction and strict backend validation, rather than trusting unvalidated model text. Keep one call/attempt, no automatic repair, and complete rollback on malformed plans. Narrowing values are ordered to match the photos shown, while their counts remain scoped SQL facts.

## 4 October — Tamil-first demo and existing VPS sequence

Persist a reply locale outside the business version. New native sessions initialize Tamil; only an explicit customer command/selection changes it. Tanglish is a first-class presentation option; canonical enums, SKU/fact identity and arithmetic remain unchanged. Backend templates localize business replies without paid translation calls; optional short model questions must follow the saved locale. Reviewed source names populate empty SQL translation fields once and preserve merchant edits. Existing English mock fixtures remain compatible.

The user has an existing Google Cloud VPS. Prefer verifying/reusing that target after GitHub checkpointing, rather than creating a second hosting service. Current localhost-only native-test permissions remain in force; a private server demo can use an authorized tunnel, while public demo/WhatsApp access needs its own verified identity/HTTPS/delivery implementation. No cloud provisioning, external delivery or paid inference is part of this checkpoint.


## 4 October 2026 — intent, interface language and catalog evidence

The user corrected over-localization of the simulator and exact-word dependence. Keep English test controls separate from persisted customer reply language. Use one metered AI decision to compare observed catalog facts, extract job-specific synonyms and propose relevant alternative families/SKU priorities; then recheck SQL scope and hard constraints. Show up to six meaningful photos without padding. Preserve explicit purchase amounts and units while browsing, but wait for a current photo choice and separate final submission consent. Retain the free-tier guard; no second automatic model call or compatibility claim based on unverified metadata.
