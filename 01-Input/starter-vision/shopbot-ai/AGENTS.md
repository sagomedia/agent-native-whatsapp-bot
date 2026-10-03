# Coding agent instructions — revision 4

## Objective

Implement the reusable retail bot engine before client onboarding. Begin with clean local startup and fixtures; add live provider/channel/payment connections separately.

At a substantial task's start, read PROJECT.md, STATUS.md, relevant DECISIONS.md entries, ARCHITECTURE.md, and the relevant work item. Read NATURAL-ORDERS.md when implementing customer interpretation, carts, confirmation or fulfillment. ARCHITECTURE-REVIEW.md records rationale; read its pertinent rows when changing a design choice. Read only the relevant flow/schema/billing details afterward. Archived material is inactive.

## Baseline and discipline

Use TypeScript/Fastify, React/Vite, PostgreSQL/Drizzle, pg-boss, the official @google/genai SDK, Better Auth, and official TypeScript MCP SDK when their milestone needs them. Initial deployment has one app process serving HTTP/UI and consuming durable jobs, plus PostgreSQL. Media uses a persistent volume; S3 and a separate worker are later adapters/deployment options.

Use a small application workflow controller and role-scoped typed services. Do not add an agent framework automatically. The SDK provides model/media/function-calling primitives; the application owns state, permissions, routing, business validation, retries, metering, and delivery.

For a new dependency or major abstraction, record the concrete requirement, simplest credible alternative, maintenance cost, and condition for revisiting it. Keep useful proven libraries for auth/jobs rather than recreate them merely to minimize package count. Routine local decisions remain autonomous.

Pin compatible stable package/model/API versions. Test structured text/image/audio output and usage capture before building a broad framework around them. Native function-calling continuation must preserve documented content/history, call IDs, and signatures; do not reconstruct only partial responses or assume an unlimited automatic loop.

## Execution rules

- Establish tenant/actor/role from trusted server identity, never model arguments.
- Known IDs/buttons/confirmed proposals call deterministic services directly. Target zero model calls for these.
- Open text/media targets one structured interpretation call; validate intent/evidence with Zod before action.
- Combine media understanding and intent extraction when correct. Do not automatically pay for preprocessing plus a second agent call.
- Configurable normal-turn ceiling: two total provider attempts including retries/optional follow-up. On exhaustion, use clarification/handoff. Exceptions need a measured capability requirement and spend policy.
- Render catalog facts, variant questions, totals, and routine order states from services/templates. Optional model wording must be bounded and may not replace authoritative facts.
- Persist short structured state and relevant context. No full catalog/history prompt.
- Customer media creates attachments/analysis, not catalog changes. Owner media creates drafts/proposals until explicitly reviewed.
- Owner price/stock voice edits require exact target, transcript and before/after preview, explicit confirmation, version check, source policy, and audit.
- Native media responses include observation/transcript and intent. Cache reusable observations separately from context-specific intent; asset hash alone cannot cache a different request's meaning.
- Maintain tenant-scoped retrieval, composite entity relationships, isolation tests, and database access policies before hosting real multi-store data.
- Make ingress, jobs, cart/proposal actions, requests, usage, and payment events idempotent. Reconcile uncertain external effects rather than claim exactly-once provider execution.

## Billing/payment invariants

Every real model attempt uses the metered adapter with dated rates and budget enforcement. Provider cost and merchant billable amount are separate. Capture thinking/cache/modality units when supplied; unknown usage remains unknown until reconciled.

Product price/payment amounts use integer paise; quantities use validated decimals; tiny provider costs keep precision until invoice rounding.

Staff approve the quote before product-payment link issuance. Payment, acceptance, and fulfillment are separate states. Only verified gateway state can mark payment paid; screenshots/redirects are not authority. Platform invoices and merchant payments use separate accounts.

## Delivery and verification

Mock mode requires no paid keys and automatically migrates/seeds on first boot with a startup lock. Live mode never seeds demo records. Do not call a command runnable until it works from a clean setup.

Continue authorized reversible local work; missing client records/credentials block corresponding real tests, not engine implementation. Do not publish, contact customers, spend paid API money, or change live records without authorization for that action.

Verify behavior that can fail: tenant/role isolation, variant uncertainty, media record effects, stale proposals, restart/replay, budgets, modality accounting, quote approval, and duplicate/out-of-order payment events.

Move completed work with evidence to work/completed/ and update STATUS.md. Separate mock evidence, live adapter smoke tests, real hardware evaluation, and commercial results.

## Natural-order invariants

Interpret whole shopping lists and compound instructions, preserve all requested lines, use versioned drafts and targeted clarification, and never silently omit unresolved items. An exact yes is a deterministic action only when bound to one current unexpired pending question/summary. An edit requires a new review. Customer yes submits a request; shop approval/payment/packing/readiness remain separate. Real staff/integration events authorize ready-for-pickup and configured location messages.
