# Bot implementation architecture

This is the implementation specification for the reusable engine. All components described here are planned.

## 1. Concrete baseline

| Component | Choice | Responsibility |
| --- | --- | --- |
| Runtime | TypeScript on supported Node.js LTS | API, worker, tools, and shared contracts |
| HTTP | Fastify | Webhooks, owner API, simulator, health, MCP integration |
| Dashboard | React + Vite | Chat simulator, products, drafts, proposals, orders, usage |
| State | PostgreSQL + Drizzle | Relational records, migrations, transactions |
| Jobs | pg-boss | Async media, conversation turns, sends, reconciliation |
| Agent loop | Vercel AI SDK ToolLoopAgent | Bounded model/tool/model execution |
| Model provider | @ai-sdk/google, direct provider access | Initial Gemini calls without an AI Gateway requirement |
| Media adapter | AI SDK image handling; official @google/genai for audio/file handling when needed | Structured image evidence/transcripts with captured usage |
| Owner sessions | Better Auth + Drizzle adapter | Authenticated dashboard identity |
| MCP | Official TypeScript MCP SDK | Authenticated owner tools over shared services |
| Media storage | Local volume, replaceable S3-compatible adapter | Binary files; database stores metadata/references |
| Product payments | Razorpay Node SDK / hosted Payment Links adapter | Staff-approved payment links and verified payment events |
| Packaging | Docker Compose | One API container, one worker container, one PostgreSQL container |

API and worker are two processes from the same codebase/container image, not separate business services. API serves the compiled dashboard. Local media is a persistent volume shared by API and worker. Production can replace it with an object store; the database still contains the metadata.

No dedicated vector database, Redis, Kubernetes, or managed agent runtime is required for the initial implementation. These are design choices to keep the dependency count small, not throughput benchmarks.

## 2. Components and runtime direction

~~~mermaid
flowchart TB
  W["WhatsApp or simulator"] --> A["API: identity, validation, durable ingress"]
  D["Owner dashboard or MCP"] --> A
  A --> Q["PostgreSQL jobs and event state"]
  Q --> R["Worker: normalize input and run role-scoped agent"]
  R <--> L["Metered model/media adapter"]
  R --> S["Typed domain services"]
  A --> S
  S --> P["PostgreSQL business data and media references"]
  S --> O["Durable outgoing events"]
  O --> X["Channel and payment adapters"]
~~~

## 3. Which agent and SDK

Use one customer agent definition per turn, configured with the store profile and role-scoped tools. Use a separate owner agent definition for the dashboard's conversational editing. They are reusable definitions, not continuously running autonomous agents for every store.

External AI hosts using owner MCP already supply the model/agent. An MCP call normally goes straight to the same application service; we do not invoke our owner model simply to repeat the host's tool decision. Media processing invoked by an MCP tool is still metered if our backend calls a provider.

Vercel AI SDK is selected for its tool loop, TypeScript schemas, provider adapters, and loop control. OpenAI Agents SDK and Google ADK are valid alternatives; this plan does not require their additional orchestration abstractions. Do not stack all three agent frameworks together.

Initial default model for evaluation: gemini-3.1-flash-lite. Use explicit google(modelId) provider construction; bare gateway-style model strings must not silently introduce a gateway account. Model identifiers and provider settings are store/platform configuration. Capability and quality checks decide whether vision/audio need a different model.

The initial experiment bounds the customer tool loop to 3 model steps and the whole turn to 4 provider calls including preprocessing. Exact ceilings are configuration and evaluation targets, not accuracy guarantees. On exhaustion, send a recoverable clarification/handoff. Set limits explicitly rather than inherit SDK defaults. Current AI SDK documentation uses version-specific stop-condition APIs; pin versions and use their documented API.

## 4. The agent loop

1. Server establishes tenant, actor, role, conversation, request ID, and budget.
2. Worker turns text/media into a NormalizedInput. Customer media analysis is a read/search operation.
3. Build context from approved store policy, structured conversation/cart state, and a small recent-message window.
4. Agent selects a typed tool such as search_products with structured constraints.
5. Tool handler receives trusted server context, checks permission/schema, and calls a domain service.
6. Tool returns a bounded result containing actual SKU/specifications/source price/stock freshness.
7. Agent asks a narrowing question or proposes the next action. Validated mutations occur through services and explicit state transitions.
8. Persist run/usage/result and outgoing intent. Deliver through the channel adapter.

Exact SKU clicks, confirmation buttons, known order-status commands, and cart arithmetic can bypass the model and call deterministic services. This reduces model calls while retaining AI for ambiguous language.

## 5. Tools and role boundaries

| Customer tools | Owner dashboard/MCP tools |
| --- | --- |
| search_products, get_product | search_products, get_product |
| get_cart, set_cart_line | create_product_draft, review_product_draft |
| submit_order_request | propose_product_change, apply_confirmed_change |
| get_own_order_status | list_order_requests, approve_quote, decline_request |
| get_approved_payment_link | get_usage_summary, preview/apply_import |

Services scope every entity to the trusted tenant and actor. A model cannot choose a different tenant by changing a tool argument. Owner membership derives from authentication; customer identity derives from the verified channel conversation.

Price/stock changes use proposal IDs and current record versions. Actual payment amount, invoice amount, stock effects, and order confirmation are application logic. No model gets SQL, shell, arbitrary filesystem, or unrestricted payment tools.

## 6. Persistent conversation state

Persist messages, attachments, normalized input, pending question/choices, selected SKU, cart/order references, and owner proposal references. Model context is an input view of this state, not the sole memory.

Keep a small recent history (initial target: 6–10 messages) plus state and relevant candidates. Use summaries only when they measurably help. Maintain conversation serialization or versioned state transitions so simultaneous messages do not overwrite a selection or apply a cart change twice.

Ingress stores the verified event with a unique key and creates a durable event/outbox entry transactionally. A dispatcher schedules work with pg-boss; job execution deduplicates by event/run ID. A database commit cannot be followed by a lost in-memory enqueue.

## 7. Client-specific behavior

Store configuration contains profile, allowed languages, product specification schema, approved aliases, clarification questions, fulfillment rules, enabled tools, model policy, media limits, budget, and channel/payment connections.

Hardware uses size/thread/material/brand; another retail profile can use flavor/weight or color/size. Core search/cart/order services remain shared. Profiles add validated policy and domain-specific functions, not arbitrary executable prompts.

Adding a client creates a tenant, connects its channel/account, sets a profile, imports records, and grants owner access. Those are operations on an already working engine.

## 8. Efficient and affordable operation

- Share code and infrastructure across modest store workloads; isolate store data and spend.
- Use deterministic actions for known IDs/buttons and AI for interpretation.
- Retrieve a small candidate set; start with exact filters, aliases, and PostgreSQL text search.
- Analyze media once per unique input/preprocessing version; store the evidence/transcript and reuse it within that conversation.
- Tenant-scope media analysis caches and invalidate catalog search caches after edits.
- Reindex only changed catalog assets if embeddings are introduced later.
- Keep images legible after resizing; do not compress away specification labels.
- Use bounded audio duration and total request budgets.
- Limit concurrency and queue workloads rather than buy a large server for an unmeasured peak.
- Track cost from the first real call; measure heavy conversations, retries, and support.
- Treat hosting, storage, WhatsApp delivery, gateway fees, and AI usage as real cost categories even if current server capacity is free.

A shared deployment reduces duplicated fixed work. Actual per-store affordability and server capacity require measurement.
