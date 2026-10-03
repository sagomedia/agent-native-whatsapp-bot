# Decisions — revision 2

Date: 2026-10-01.

## User decisions

| ID | Decision |
| --- | --- |
| D001 | Build the bot engine first; treat client onboarding as a later use of it. |
| D002 | Keep the first real hardware-store trial to 50 demo products. |
| D003 | Staff confirm order requests. |
| D004 | Owner has both MCP and dashboard access. |
| D005 | Support text, photo, and voice input; explicitly design media/database behavior. |
| D006 | Billing export is reportedly available, but not obtained. |
| D007 | Include both store AI usage billing and customer product payments. |
| D008 | Preserve ₹10,000 setup + ₹1,000/month + additional AI charges. |

D007 supersedes the previous exclusion of payment collection. Staff order approval remains required; payment state is separate.

## Technical recommendations chosen for this plan

| ID | Baseline | Rationale |
| --- | --- | --- |
| T001 | TypeScript/Fastify and React/Vite | One language for API, tools, and dashboard; built UI served by API. |
| T002 | PostgreSQL + Drizzle | Durable relational business state and migrations. |
| T003 | pg-boss with API and worker processes | Durable background work using the existing database. |
| T004 | Vercel AI SDK ToolLoopAgent + direct Google provider | Reusable typed tool loop and provider replacement without a hosting commitment. |
| T005 | Gemini 3.1 Flash-Lite as initial test model | Published low-cost text/image/audio candidate; quality must be evaluated. |
| T006 | Official Google GenAI adapter for audio/native file handling if needed | Keep media compatibility explicit without adding another agent framework. |
| T007 | Two agent definitions: customer and dashboard owner | Different tool permissions; only the relevant role runs for a turn. |
| T008 | Official TypeScript MCP SDK | External owner AI calls shared service tools directly. |
| T009 | Better Auth with Drizzle for dashboard sessions | Verified Fastify/Drizzle integration. MCP host authentication is a separate compatibility task. |
| T010 | Local persistent media volume; optional S3-compatible adapter | Small local dependency count and a hosted storage path. |
| T011 | Razorpay hosted standard Payment Links + signed webhook verification | Initial India payment adapter; merchant account and eligibility still required. |
| T012 | Per-store configuration/domain profiles | Reuse engine instead of copying customized bot implementations. |

These are recommendations for implementation, not assertions that the packages are installed or the user has provider access. Pin compatible stable versions in task 001/004; current docs differ across SDK versions.

## Deferred or open

- Exact existing hosting capacity and monthly operating cost.
- WhatsApp provider/Graph API version, onboarding permissions, and effective rates.
- Actual required languages; trial budget; media retention; fulfillment and taxes.
- Usage invoice policy, retry billing policy, rate conversion/markup, quotas, and support limits.
- External MCP host and OAuth requirements; dashboard sessions alone do not solve MCP authorization.
- Merchant payment account, live credentials, gateway fees, refunds process, and staff quote expiry.
- Automatic billing-software sync, vector/image retrieval, synthesized voice replies, service bookings, subscriptions/autopay, and stock reservations.

Keep these out of inferred promises. New evidence can change a technical baseline with a recorded reason.
