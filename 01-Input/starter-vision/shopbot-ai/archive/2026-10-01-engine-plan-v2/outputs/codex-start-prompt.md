# Revised starting prompt

Open the shopbot-ai project directory in Codex and paste the text below.

---

Implement the reusable ShopBot AI engine, starting with the runnable local foundation. Follow AGENTS.md. Read PROJECT.md, STATUS.md, DECISIONS.md, ARCHITECTURE.md, IMPLEMENTATION.md, and task 001. Read the relevant flow/schema/billing specification as each task needs it.

The recommended baseline is TypeScript/Fastify, React/Vite, PostgreSQL/Drizzle, pg-boss, Better Auth, Vercel AI SDK ToolLoopAgent with direct Google provider access, official TypeScript MCP SDK, and a Razorpay Payment Links adapter. Verify and pin compatible stable versions. Use a modular application with API and worker processes from the same image. Serve the built dashboard through the API.

First deliver Docker Compose startup, persistent state/media, seeded synthetic retail profiles, a conversation simulator, and mock AI/payment adapters with no paid credentials. Then implement tenant-scoped services, budget/usage adapters, text agent, image/voice pipelines, owner tools, WhatsApp, and payments/invoices in queued task order.

Do not wait for the merchant export or real photos to build the engine. Missing credentials block live provider tests, not local implementation. Label mock behavior clearly.

Customer image/audio uploads create message/analysis records, not products. Authenticated owner uploads can create drafts. Owner voice changes require exact targets, before/after previews, explicit confirmation, version checking, and audit. External MCP calls use shared services directly.

Use bounded role-scoped agent tools and durable conversation state. Preserve exact SKU identity and source-backed prices/stock. Staff approve quotes before customer payment links; only verified provider events update paid state. Store AI usage invoices are separate from merchant product payments.

Run meaningful tests and verify clean startup. Update STATUS.md and completed work with evidence. Keep routine local choices autonomous. Do not publish, contact customers, make paid API calls, or alter live merchant records without authorization for those actions.

Report which local commands actually work, which flows were tested, which integrations remain mocked, and the smallest missing input for the next live check.
