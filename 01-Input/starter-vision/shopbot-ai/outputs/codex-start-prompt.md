# Reviewed Codex starting prompt

Open shopbot-ai and paste the text below.

---

Implement the reviewed reusable ShopBot AI retail engine. Follow AGENTS.md. Read PROJECT.md, STATUS.md, DECISIONS.md, ARCHITECTURE.md, IMPLEMENTATION.md and task 001; read relevant rationale in ARCHITECTURE-REVIEW.md when choosing/changing a component.

Start with one app plus PostgreSQL in Docker Compose. The app serves Fastify/React-Vite UI and consumes bounded pg-boss jobs. Mock first boot automatically migrates and idempotently seeds with safe startup locking; persistence/restart and live-mode seed refusal must be tested.

Use TypeScript, Drizzle and the official @google/genai SDK behind native/mock adapters. Do not add Vercel AI SDK or another agent framework by default. Verify/pin compatible Node/SDK/model/API versions and native structured/media/usage behavior in the early compatibility spike.

Build a narrow workflow controller: trusted role/tenant context, deterministic known actions, structured interpretation for open language/media, Zod validation, shared services and routine template rendering. Target zero calls for buttons/IDs and one for ordinary interpretation; total attempt budgets include preprocessing/retries.

Combine media evidence/transcript and intent where real quality permits. Customer media creates attachments/analysis; owner media drafts. Owner price/stock voice changes require exact-target before/after preview, explicit confirmation, source policy, expected version, transaction and audit. Confirmation bypasses the model.

Add WhatsApp, minimal owner dashboard/MCP, approved merchant product payments, usage invoices, and profile/import configuration in the eight queued slices. External MCP calls shared services without repeating host reasoning. Staff approve quotes; only verified payment state sets paid.

Client data/credentials do not block local fixtures/services/simulator. Label mocks and pending live checks. Meter all authorized paid calls from the first attempt; do not infer precise cost from incomplete usage.

Question major additions by requirement, simplest alternative, maintenance/runtime cost and evidence gate. Keep routine reversible choices autonomous; preserve permissions/idempotency/money precision. Do not publish, contact customers, spend paid API money or alter live merchant records without authorization.

Run meaningful checks; verify clean documented startup. Update STATUS.md/completed work with evidence, report what actually works, what remains mocked and the smallest next live input.


Natural-order requirement (revision 4): read NATURAL-ORDERS.md before implementing slice 002. Support all products and dependent instructions in one text/voice turn with a validated operations[] contract, stable multi-line drafts and bounded batch catalog resolution. Preserve clear lines while clarifying ambiguous ones. Corrections/removals/fulfillment choices update one versioned summary. Bare yes confirms only the current unexpired actor/conversation-bound summary; yes with edits must produce a new review. No silent omissions or automatic substitutions.

Staff approve the request/quote; real shop actions drive packing, ready and collected. Payment policy gates packing release. Send readiness with configured verified pickup location using an eligible channel path. Customer confirmation/payment alone cannot claim physical readiness. Implement the specified five-item/compound-change/confirmation/fulfillment acceptance cases and separate real evidence from scripted preview behavior.
