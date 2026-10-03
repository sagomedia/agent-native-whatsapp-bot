# Starting vision: agent-native WhatsApp bot

Recorded 2 October 2026.

## User request and provenance

The user supplied `shopbot-ai-codex-starter.zip`, asked to store it as the starting vision, identified the project as an agent-native WhatsApp bot, and authorized starting development. The original archive and its extracted documents are retained in `01-Input/starter-vision/`; `SOURCE.md` records its checksum.

The documents include historical agent instructions and statements labeled “user-confirmed.” Those statements are source material, not independent confirmation in this conversation. In particular, the hardware client, 50 real SKUs, available export, separate scripted website, ₹10,000 setup / ₹1,000 monthly quote, and billing terms remain provisional.

## Adopted product direction

The user clarified that the goal is a reusable agent-native WhatsApp engine: deterministic backend tools enabled by AI, with the browser application serving as a local test harness. Build a reusable retail engine first, with WhatsApp as its initial real customer channel. Use a synthetic hardware profile to exercise the shared engine before onboarding a shop.

“Agent-native” means the assistant understands whole shopping requests and proposes validated operations using relevant state and catalog data. Application services execute permitted actions. An LLM transcript is not the source of business truth, and the engine does not need a general agent framework to start.

- Text, photo and recorded voice share a structured interpretation contract.
- Preserve every line of multi-item requests and compound edits; clarify missing details without losing resolved lines.
- Bind customer confirmation to one current, versioned review. Customer confirmation submits a request; staff approval, payment and physical readiness remain separate.
- Catalog prices, stock, totals and permissions come from backend facts.
- Owner dashboard and MCP use the same authorized services.
- Meter paid inference from its first real use, with limits and explicit unknown usage.
- Start with local mocks; add real model, WhatsApp and payment adapters at separate milestones.

## Initial technical direction

TypeScript/Fastify; PostgreSQL/Drizzle; pg-boss consumers in the app; React/Vite simulator/dashboard. Add the official Google SDK, owner authentication and MCP SDK when their milestones require them. One app plus PostgreSQL is the local baseline. Keep media on a persistent volume initially.

## Milestones

1. Local foundation: reproducible startup, locked migration/seed, synthetic catalog, durable messages and persistent multi-line draft simulator.
2. Natural text ordering: structured interpretation, complete shopping lists, clarification, review/confirmation and metering.
3. Photo and voice through the same operation contract.
4. Verified WhatsApp ingress, durable delivery and channel eligibility.
5. Authenticated owner dashboard/MCP, approval and fulfillment actions.
6. Approved merchant payments and separately configured usage billing.
7. Profile/import configuration and second fixture store.
8. Recovery, isolation, model/channel evaluation and real shop trial.

## Provisional choices

Real catalog, languages, merchant identity, pickup rules, payment provider/policy, prices charged for this service, deployment destination, model choice/rates and owner MCP host need evidence or later user decisions. The previous `01-Input/plan.md` remains useful context; its one-shop/pay-at-pickup defaults do not silently settle the expanded starter's commercial choices.

Current authorization covers reversible local implementation and mock verification. Real service connections, paid model calls, merchant transactions and customer messaging require the corresponding user authorization.

## Implementation checkpoint — 2 October 2026

Reusable service tools, local mock conversation runtime and the native Google text adapter with durable spending guards are implemented. Real inference remains disabled by default; live model accuracy/cost evaluation and verified WhatsApp connection are pending. The simulator is a local test harness. This checkpoint does not change the separate authorization requirement for paid calls or customer messaging.

## Current provider constraint — free tier

On 2 October 2026 the user confirmed the Gemini project currently uses the free tier with strict quotas and expects to upgrade later. No paid spending is approved. Keep ALLOW_PAID_INFERENCE=false and AI_BUDGET_USD=0. A future plan upgrade does not itself authorize paid calls.

The supplied AI Studio screenshot shows Gemini 3.5 Flash Lite limits of 15 / 250K / 500, consistent with the documented RPM/input-TPM/RPD dimensions; verify the active project/model limits before a live run. Quotas are project-wide, not per key, and other apps may consume them. See https://ai.google.dev/gemini-api/docs/rate-limits.

Free-tier evaluation should use serial small tests, conservative local request/token/day limits, no retry bursts or automatic paid model fallback, and stop on quota errors. The existing adapter already disables hidden SDK retries. A dedicated free-tier quota/configuration path is still needed before using the current paid-gated evaluation CLI. Record usage honestly; a local spending cap is not a provider-side free-tier guarantee.

2 October free-tier setup: paid authorization remains false and budget zero. Durable project/model quotas added and 22 offline integration tests pass. One real synthetic Gemini call returned 618 tokens but failed runtime validation without draft changes. No retry. Key/account access works; structured-output diagnosis and live extraction evaluation remain pending before WhatsApp delivery.

Subsequent live browser test passed after strict add -> add_item adapter translation: five-item ₹914 review. Free-only local test page at localhost:3017/native-test, original mock demo preserved, 24 tests pass. Broader quality evaluation and WhatsApp delivery remain pending.

2 October user refinement: prioritize a friendly, context-aware shop assistant over robotic tool narration. Clarify vague sizes/types/quantities, tolerate spelling through suggestions, use real catalog photos in one reply, cap cards at ten, avoid promotion/image blasts and optimize paid outbound count. User’s ₹0.50/message is a configurable planning assumption; actual Meta rates/categories/window/free tier must remain separate. The WhatsApp-style local preview, distinct 30-image demo and pure delivery planner are implemented; 28 tests and one live clarification flow pass. See WHATSAPP-EXPERIENCE.md.

## 2 October — agent behavior beyond command extraction

The user rejected an assistant that behaves mainly as an AI command parser plus fixed backend replies. The intended assistant must remember the customer’s shopping goal, observe real catalog results, choose useful searches and follow-up questions, recover from no matches and rate limits, and distinguish browsing/quotes from ordering. Keep deterministic services as the source of commerce facts and consent; make the conversational decision layer more capable.

Implemented a bounded observe → decide → search → remember cycle. Native structured decisions can request up to three real catalog searches and a focused question. Results and goal context persist per authorized conversation and feed subsequent decisions. Rechecks execute real reads without a new model call; exploration does not add products, and substitutions need an explicit current selection. One model request per turn and existing project-wide free limits remain. This is an early agent prototype with a limited search/ordering tool set, not an unrestricted autonomous loop or a live WhatsApp connection.

## 3 October — mind map, keywords and recorded voice

The user requested a scalable store → department → family → brand/specification mind map. AI should extract useful keywords from text or speech, then deterministic tools rank actual products and ask useful narrowing questions with two or three real photos where available. Empty exact search must not claim shop unavailability. Relevant alternatives must be clearly labelled and need acceptance; unrelated photos must not be invented to fill the count. Preserve all requested items, verified catalog prices/names/images/units and separate final consent. No customer profiling is required.

This is now implemented in the local backend and microphone harness; actual evidence is recorded in `03-Output/012-catalog-mindmap-and-voice.md`. Clean local Git branches/checkpoints and portable export preserve both the verified visual-confirmation baseline and this phase. GitHub publication is a future user action.
