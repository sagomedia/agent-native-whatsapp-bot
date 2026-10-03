# Why review — revision 3

Purpose: justify components by actual product requirements and keep a concrete alternative and revisit condition. This is an engineering review, not measured runtime evidence.

## 1. Why Vercel AI SDK?

It was a reasonable TypeScript tool-loop and multi-provider abstraction. It can run in Node; selecting it does not imply Vercel hosting. Its benefit is integration standardization, not a cheaper provider token tariff.

Our first provider is Gemini. Revision 2 also added native Google media calls, leaving two provider integration layers before we had a second provider. For the first engine, choose @google/genai for text, images, audio, and native structured/function interfaces behind a small adapter.

Tradeoff: native SDK means we own the narrow controller and Gemini-specific compatibility tests. We do not claim it handles every future provider. Revisit AI SDK if a second production provider is needed or its UI/tool features measurably remove more maintenance than the added abstraction costs.

## 2. Question every major choice

| Question | Decision and reason | Alternative / condition to change |
| --- | --- | --- |
| Why TypeScript? | Shared server, dashboard, tool/schema types and MCP implementation | Python if existing code/team or local ML requirements make it materially easier |
| Why Fastify? | Explicit HTTP/schema lifecycle and webhook/owner endpoints without another full-stack server | Keep an existing suitable server; do not rewrite it to match this plan |
| Why an agent framework? | None required initially; use a controlled interpretation/action workflow | Add a framework for demonstrated multi-step orchestration requirements |
| Why native Google SDK? | One Gemini-first integration with media and usage access | AI SDK if genuine cross-provider/UI requirements outweigh native simplicity |
| Why this model? | Gemini 3.1 Flash-Lite is an initial low-cost candidate, not the winning model by assumption | Compare whole-conversation correctness/cost/latency; replace if it fails spoken numbers or hardware evidence |
| Why PostgreSQL? | Durable related data, transactions, constraints, job state and multi-store use | SQLite fits a single-process offline prototype but changes concurrency/deployment assumptions |
| Why Drizzle? | Typed schema/migrations with visible SQL and transactions | Direct SQL is reasonable with established migration/type practices; avoid repeated schema representations |
| Why a durable queue? | Media/provider calls outlive webhook deadlines and need recovery | In-memory work loses unfinished processing after restart |
| Why pg-boss? | Existing PostgreSQL backs jobs; avoids custom leases and another server | Redis/BullMQ only after measured database contention or independent queue needs |
| Why two app processes now? | They are not required; start HTTP/job consumers in one app | Split when event-loop/CPU contention, independent scaling, or restart isolation is measured |
| Why retain business state? | Pending variant, cart, order and proposal must survive model/process changes | A model chat session alone is not authoritative business state |
| Why two agents? | One controller with two role policies/tools; external MCP does not need our owner inference | Separate specialized agents only for distinct evaluated workflows |
| Why a second model call? | Usually unnecessary after a structured intent; services/templates return facts | Use a second call for genuinely unresolved language/visual comparison, within budget |
| Why combine audio/image interpretation with intent? | One request may return transcript/evidence and requested action | A two-pass path if held-out quality beats its added cost; do not combine blindly |
| Why templates? | Stable questions/prices/totals/status can be correct and cost zero inference | Optional controlled wording for variable language; never let generated text replace source facts |
| Why no embeddings first? | Filters/aliases/text retrieval may suffice and need no indexing system | Add image embeddings/pgvector if loose visual items systematically miss; photo support still needs real evaluation |
| Why no fine-tuning? | Catalog facts change and belong in retrieval/state | Consider fine-tuning only for measured persistent interpretation behavior with suitable data |
| Why retain uploaded media? | Analysis, review and uncertain voice/photo evidence may need it | Configurable expiry for customer attachments; approved catalog images live by separate policy |
| Why owner confirmation? | Misheard number/target or stale data can change money/stock | Ordinary harmless metadata edits can use simpler authorized actions; price/stock stays explicit |
| Why a dashboard and MCP? | User requested both; visual review and conversational tools have different uses | Build the minimum surfaces, calling the same services; no duplicate inventory backend |
| Why auth library? | Session/account lifecycle is more than checking a password | Use existing supported authentication; do not hand-roll it to save one dependency |
| Why store isolation now? | This is a reusable client product, not a one-off script | Begin with one working fixture, then test two; enforce isolation before hosting real multi-store data |
| Why payments after core? | User requested payments, but text/media/service correctness comes first | Add the adapter once quote/owner identity/state are reliable |
| Why hosted payment links? | Clear quote/account binding; gateway handles payment page | Standard checkout if actual UX requires it; recurring subscription is a different module |
| Why usage metering immediately? | Paid calls must be attributable and bounded from their first use | Invoice collection can wait; measurement cannot |
| Why not a prepaid wallet now? | Store usage reporting/spend caps/invoices meet the known need | Wallet/autopay require agreed charging rules and settlement handling |
| Why not all tables up front? | Model features as small schema increments in working slices | Split price history/analysis/run detail when reporting or scale needs it |
| Why store profiles? | Retail schema/questions/policy differ without changing the core workflow | A different transaction domain, such as appointments, needs a tested module |
| Why Docker Compose? | Reproducible app/database startup and persistence on the available server | Managed hosting if operating backups/updates costs more than it saves |
| Why mock mode? | Build state/actions without credentials or paid spend | Never use mock success as proof of model accuracy or live delivery |

## 3. More important than SDK choice: unnecessary calls

A prior possible path was audio transcription -> agent interpretation -> tool call -> model wording. The reviewed routine path targets one audio/evidence + intent request, then validated services and a deterministic response.

This is a design target. Compare combined and separate paths on actual Tamil/English product names, quantities and variants. Report actual usage and failures. SDK substitution alone does not produce a cost reduction.

Deterministic button/ID/confirmation events target zero calls. Most open requests target one. Ordinary ceiling starts at two attempts including retry/follow-up. All attempts are recorded; cost caps also include permitted output/reasoning.

## 4. What simplicity must preserve

Do not remove authentication, tenant boundaries, transactions, version checks, idempotency, invoice precision, or payment verification to save dependencies. Simplify deployment and inference paths, not the authority of business records.

The controller does not accept a model-selected tenant or price as authenticated truth. No arbitrary SQL/code execution tools. Known source facts, stored states, and explicit user actions remain authoritative.

## 5. Evidence for a later design change

For each proposed addition, record requirement, baseline failure, smallest alternative, expected benefit, maintenance/runtime cost, acceptance measurement, and rollback path.

Examples: worker split needs measured job/API contention; embeddings need retrieval misses; larger model needs quality improvement; AI SDK needs real integration savings; another business module needs a concrete client flow.

No infrastructure throughput, native-SDK cost saving, or image accuracy is claimed by this review.
