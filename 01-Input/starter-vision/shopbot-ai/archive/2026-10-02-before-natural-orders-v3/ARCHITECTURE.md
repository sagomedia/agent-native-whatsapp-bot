# Reviewed bot architecture

Revision 3. Specifications only; implementation has not started.

## Stack

| Component | Initial choice | Why |
| --- | --- | --- |
| Language/API | TypeScript + Fastify | Shared types, explicit endpoints, small server surface |
| Model/media | Official @google/genai SDK | One Gemini-first provider integration |
| Workflow | Application controller + Zod contracts | Own known business states/actions without a general agent framework |
| State | PostgreSQL + Drizzle | Durable related records, constraints and migrations |
| Jobs | pg-boss consumers within the app | Restart-safe work using the database already required |
| Dashboard | React + Vite, served by app | Minimum owner/simulator interface |
| Auth | Better Auth when owner access ships | Reuse session implementation |
| Owner MCP | Official TypeScript MCP SDK | Expose shared services to external owner AI |
| Media | Persistent local volume | Add S3 adapter when hosted storage needs it |
| Payments | Razorpay hosted Payment Links adapter | Approved quote and verified merchant payment |
| Local packaging | app + PostgreSQL in Docker Compose | Two services initially; split workers only after measurement |

ARCHITECTURE-REVIEW.md includes alternatives and revisit conditions.

## Runtime

~~~mermaid
flowchart TB
  I["WhatsApp, simulator, owner UI"] --> A["App: trusted identity + durable event"]
  A --> Q["PostgreSQL-backed job consumers"]
  Q --> C["Workflow controller"]
  C --> K["Known action: no model"]
  C <--> G["Native Gemini interpretation: metered"]
  K --> S["Typed business services"]
  C --> S
  M["Authenticated owner MCP"] --> S
  S --> D["PostgreSQL + media references"]
  S --> O["Outgoing intent / provider adapter"]
~~~

A structured model result is input to the controller; there is no direct model-to-database connection. The diagram's model-to-services path always passes controller validation.

## Controlled interpretation

- Trusted server context supplies tenant, role, actor, conversation, request ID and budget.
- Exact SKU buttons, known order status, quantity buttons, and authenticated proposal confirmations bypass inference.
- Open language or media gets one structured request with relevant state and profile.
- Result contains requested action, extracted specification slots, reusable media observations/transcript, and uncertainty.
- Validate action/schema and role. Resolve entity IDs in the correct store.
- Call services, persist the business state, and render prices/questions/status from source facts and localized templates.
- Optional bounded native function calling or a second interpretation/wording request handles genuinely unresolved cases. Capture all attempts.

No general planner/discovery/matching agent chain is required. Customer and dashboard owner are role policies on the same controller. External MCP's host supplies its own reasoning and normally calls services without another backend inference pass.

## Provider adapter

Small interface: interpretText, interpretMedia, optional bounded nativeToolTurn, and captured usage/response metadata. It supports the mock and native Google implementations initially; it does not promise drop-in compatibility with every model provider.

Pin the SDK, model identifier and API endpoint after a compatibility spike. Google documents native function declarations and explicit application execution; the adapter must preserve documented full content, function-call identifiers and thought/history continuity for continuation calls.

Do not rely on unbounded SDK automatic function execution. Initial model candidate remains gemini-3.1-flash-lite; compare actual modality quality rather than choose from token price alone.

## Call policy

Targets: zero model calls for deterministic actions, one for ordinary open input/media. Initial ceiling: two provider attempts per ordinary turn including repair/retry/optional comparison. Exhaustion yields clarification or staff fallback.

Use different output limits for a short reply, a structured image interpretation, and a transcript plus intent. The earlier 300-token routine reply target is not suitable as a universal transcription cap. Ensure truncation is detected and does not turn incomplete JSON into an action.

Separate cached reusable media observations from request-specific intent. Intent cache keys include request/context/profile versions. An asset hash alone cannot answer a new question about the same image.

## Durable state and work

The app persists verified ingress with a dedup key and durable work intent before acknowledgment. pg-boss handles asynchronous jobs inside the app. Dispatch/consumer logic closes commit/enqueue gaps and is safe to replay.

Conversations contain selected/pending SKU/specifications, cart/request/proposal references, and state version. Supply only short relevant history/state to the model.

Use per-conversation sequencing or versioned transitions. Scope jobs, queries, assets, usage and settings to their tenant. Role-gated services and consistent relationships remain required before real multi-store use.

Outbox effects and provider attempts are persisted. External timeouts may be ambiguous; reconcile instead of claiming exactly-once external calls.

## Profiles and retrieval

Profiles configure specification fields/questions, aliases, approved templates/languages, fulfillment, capabilities and model/spend settings. Start with hardware. Add a second synthetic retail profile once its shared text/cart path works.

Exact IDs/specifications/aliases and PostgreSQL retrieval are baseline. Vision observations help narrow candidates; they do not prove exact dimensions or grade. Ask for missing evidence.

If visual items miss systematically, measure candidate-image comparison or stored embeddings/pgvector before adding an index. A feature should be added because the test set reveals a gap.

## Deployment gates

First boot in mock mode migrates and seeds with a database startup lock; app readiness waits for completion. Live mode migrates under controlled deployment and cannot run demo seeds.

Split job consumers into a second process from the same code image if measured heavy media/CPU work interferes with API latency, independent scaling is needed, or restart isolation helps. Until then, cap job concurrency and FFmpeg work.

Production still requires HTTPS, private database, backups, protected secrets, health checks and a real server capacity measurement. These are implementation responsibilities, not current deployed features.
