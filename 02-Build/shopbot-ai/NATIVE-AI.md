# Native text adapter and spending guards

Implemented 2 October 2026; live quality evaluation is pending. The default simulator remains mock-only. A separately enabled free-only local browser test channel can invoke Gemini. Native evaluation is an explicit local CLI command over separate synthetic fixtures.

## Current user setup: free tier only

The user confirmed the Gemini project is on the free tier, with an upgrade planned later. This supersedes the earlier suggested $1 test ceiling: no paid budget is authorized. Save GEMINI_API_KEY locally, keep ALLOW_PAID_INFERENCE=false and AI_BUDGET_USD=0. Do not enable the paid evaluation instructions below for the current account setup.

A dedicated free-tier CLI path is now implemented. It requires ALLOW_FREE_INFERENCE=true, a stable AI_QUOTA_PROJECT (current setup: invisible-erp), paid inference disabled and a zero budget. Quota reservations persist in PostgreSQL across stores/conversations and restarts. Local caps are three requests per rolling minute, at least 15 seconds apart, and 100 requests per Pacific calendar day. Each call reserves a conservative 64K input allowance within the bounded text context; three calls reserve 192K input tokens per minute. Failed/unknown attempts count, and a message gets at most one free attempt. A 429 pauses this project/model for 15 minutes with no automatic retry or model fallback.

These controls cover this application's database, not usage from other applications or another database. Byte bounds are a conservative local token allowance, not an exact tokenizer measurement. Google can throttle below advertised limits. The API project must remain on the free tier: a local zero budget cannot force Google to provide free service after billing is enabled. Free ledger entries use free_declared with null invoice/cost fields; they are not verified invoices. [Google quota documentation](https://ai.google.dev/gemini-api/docs/rate-limits).

Run one explicit synthetic evaluation from this build folder:

```sh
docker compose run --rm -e ALLOW_FREE_INFERENCE=true -e AI_QUOTA_PROJECT=invisible-erp app npm run native:preflight
docker compose run --rm -e ALLOW_FREE_INFERENCE=true -e AI_QUOTA_PROJECT=invisible-erp app npm run native:eval
```

On 2 October, configuration preflight passed and one real request returned 416 input + 202 output tokens. The runtime rejected the response before applying any draft changes. The original attempt predates sanitized failure-code instrumentation, so the precise validation failure is not recorded. Key/account/model access is confirmed; the five-item extraction smoke criterion has NOT passed. Do not describe live quality or WhatsApp as ready. Diagnose the structured-output contract in the next controlled evaluation. No retry was made this turn.

## Provider profile

The official @google/genai SDK is pinned to 2.26.0. The initial evaluation candidate is gemini-3.5-flash-lite, standard tier, minimal thinking, one candidate and at most 4096 generated tokens including thinking. This is a candidate for measurement, not a quality recommendation. Google lists structured output support and a 1,048,576 input-token limit for [this model](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite).

The adapter sends the customer message, public catalog names/SKUs/aliases/units and current draft. It caps context at 200 products and 64 KB. It does not send merchant cost/margin data, owner credentials or conversation identity. Catalog/draft strings are untrusted data in the prompt. The model returns proposed operations, checked by the same strict backend schema; confirmation and staff/payment permissions remain outside model arguments.

The adapter uses the native Generate Content API with [structured JSON output](https://ai.google.dev/gemini-api/docs/generate-content/structured-output). SDK retries are explicitly set to one total attempt and automatic function calling is disabled. These settings were verified at the SDK's HTTP boundary with local fake responses, including a 503 response producing one request. Known review/status/confirmation actions still bypass inference.

## Accounting

A dated rate snapshot stores USD input/output prices and model limits. The current [standard text rates](https://ai.google.dev/gemini-api/docs/pricing) were checked on 2 October 2026: $0.30 input and $2.50 output per million tokens. Output includes thinking. This profile expires on 1 November 2026; recheck official rates and compatibility before extending it. There is no automatic model fallback or unpriced model alias.

Before each generation call, the runtime locks the store budget and commits a worst-case reservation plus attempt record. The initial conservative reservation uses the entire supported model input limit and the configured output cap: $0.324813. This avoids estimating token counts from character length and needs no extra token-count network call. It is a temporary hold, not a claim about the likely cost of one shopping message. A configured budget below this hold cannot start a call.

Amounts use integer micro-USD (1,000,000 = $1), separate from product paise. After a response, consistent usage settles an estimate, releases the hold and records the rate snapshot. Thinking is included through total minus prompt tokens. Implicit cached input is conservatively charged at the uncached rate; these are application spending estimates, not provider invoices or merchant billing. Invalid/truncated JSON still records usage/cost; rejecting a proposed operation does not refund inference.

Missing usage, provider errors, client timeout or a crash leave an unknown-cost hold. [SDK cancellation](https://googleapis.github.io/js-genai/release_docs/interfaces/types.GenerateContentConfig.html) does not ensure server cancellation, so holds are not automatically released. Recovery persists unknown attempts and counts them toward the two-attempt ceiling. Consistent late usage can settle an existing hold once. Unexpected usage beyond the pinned bounds blocks further spending for that store. Administrative reconciliation is future work; do not clear holds merely to permit retries.

The budget is a fixed cumulative store ceiling across all conversations and repeated evaluations. It is not reset daily or per run. A changed configured ceiling is refused; increases/reconciliation require a separately authorized administrative change. A model identity mismatch cannot mutate the draft and retains its hold. Cached interpretation reuse requires the same provider and source draft version.

## Run when credentials and spending authorization are available

Add the key locally to the ignored .env file; do not paste it into chat. Keep ALLOW_PAID_INFERENCE=false while developing. When an authorized test is ready, set the flag true, set AI_MODEL=gemini-3.5-flash-lite and set AI_BUDGET_USD to the explicitly approved USD ceiling. No positive budget is supplied by default.

From the build folder:

```sh
# Configuration and rate arithmetic only; no provider or database calls.
docker compose run --rm app npm run native:preflight
# Explicitly invokes one native interpretation over a fixed five-item synthetic list.
docker compose run --rm app npm run native:eval
```

Preflight checks configuration, not the validity of the key or account/model access. The evaluation store is fixed and synthetic; each run uses a new conversation while the store budget persists. Its output includes lines/review, sanitized reply, token counters, rate snapshot and committed/held totals. A successful first smoke test requires all five lines, a ₹914 review, one successful attempt and accounted usage. It never sends messages to a customer, takes payment or confirms the synthetic request.

These commands need an already running local database. The Compose app receives configuration from .env but serves only the mock simulator; setting the flag does not enable an unauthenticated paid HTTP endpoint. The mock reset refuses any default demo conversation containing paid attempts and does not delete the evaluation store's accounting.

## Verification limits

Twenty-two integration tests pass with local fake SDK/provider responses. They verify adapter wire shape, validation, budget concurrency, known-action bypass, rejected-output costs, unknown usage, provider-error privacy, crash recovery and prior business guards. They do not establish live extraction accuracy, Tamil/English quality, latency, actual billed totals, or account access. Full live evaluation and WhatsApp integration remain pending.

## Working local AI browser test

Earlier failed attempts above are historical. The kind=add wire-tag mismatch was diagnosed and fixed with a strict adapter translation to add_item. Backend operation and permission checks are unchanged. A real browser smoke now passes: five products, ₹914 review, 728 tokens. Build and all 24 tests pass.

Open http://localhost:3017/native-test, click New AI test and enter a shopping list. ALLOW_LOCAL_AI_TEST=true explicitly enables this channel with the free-tier configuration; paid adapters are refused. Default / stays mock-only. Quotas apply across CLI and browser. No WhatsApp delivery. New test conversations retain previous data; app restart requires a fresh session. Signed cookies bind server-created local conversations.

This is local test infrastructure, not production authentication. Keep Compose on loopback and do not expose the channel publicly. Broader text/language/correction evaluation remains pending. See workspace 03-Output/006-live-ai-browser-verification.md.

Conversation refinement: native interpretation now includes bounded recent history and optional conversation/clarification intent; fact-based presentation needs no second generation. Friendly greetings and choices use no calls. New browser sessions use the separate public image demo. 28 tests pass and the live screw-box/paint clarification flow passed (1933 tokens). See WHATSAPP-EXPERIENCE.md for persona, WhatsApp feature constraints and cost policy.

## Natural ordering refinement

Provider wire operations accept validated lineId UUID aliases only for set_quantity/remove_item and translate to the unchanged backend reference contract. requestedUnit preserves customer packaging/measurements; needs_unit prevents inferred conversions, and priceQuantity/priceUnit produce verified read-only quote arithmetic. shopQuestions selects trusted factual clarification copy; no freeform price/stock/owner promise is accepted. Recent context and all existing budget/lease/replay/confirmation checks remain.

Final edge-case validation: 41 integration tests pass. Explicit price inquiries and variant quote buttons are read-only; Add to my list is a separate explicit action. The generation schema remains the compact canonical contract, with strict response-only compatibility aliases.

## Bounded agent planning and persistent observations

The earlier adapter primarily extracted operations. It now receives real search_products observations plus sanitized remembered search results. next=assist supplies up to three queries, an optional pending line UUID, and a brief clarification question; its operation array must be empty. The runtime executes the queries through the same scoped read tools, grounds cards/prices in those results, and stores bounded assistant_memory in the conversation. Commerce assertions are not accepted as assistant prose. Only constrained questions can accompany fact-based presentation.

The cycle continues across customer turns: observe current facts → one model decision → execute validated read/mutation tools → persist results → one reply. It does not make a second generation to reflect on its own newly chosen searches in the same turn. This deliberately retains the one free attempt per message limit. Deterministic known actions remain useful agent tools and do not require inference. Price, identity, review/consent, atomic rollback and frozen submitted-request guards still apply.

53 integration tests pass with offline/scripted provider responses. This establishes the tool/memory/permission boundaries, not broad live conversational quality. See 03-Output/009-agent-discovery.md for separately labeled real Gemini checks.

Final live check passed: job-based PVC cutting request → actual cutter/blade image choices + pipe-diameter question, one 2753-token generation, empty order draft. Three successful Gemini generations were used across this refinement turn; deterministic rechecking used no additional generation. Local server is healthy and paid authorization remains false. Evidence: ../../03-Output/009-agent-discovery.md.


### Visual product acceptance (3 October 2026)

The image-demo store opts into `store_policies.require_product_confirmation`. Inferred exact matches are proposals, just like ambiguous product alternatives. A `products` pending check binds up to three requested line IDs and at most ten displayed product cards to the current draft version and a fifteen-minute expiry. Large lists (up to twenty lines for this policy) advance only after customer action; they never generate multiple automatic outbound replies.

`confirm_product_choices` requires trusted channel consent and verifies the SKU belongs to that displayed line, checks the current catalog identity, and records product acceptance separately from quantity and final submission. SKU, name, unit, image or version changes require a new check. Quantity-only edits retain product acceptance. A displayed browse/quote card can already supply product acceptance; arbitrary callbacks cannot bypass the check. New cards show request labels and quantities, and final review includes up to ten informational product photos. All lines were checked on earlier pages when the review exceeds ten products.

Quantity replies such as “5 bottles” and current product buttons bypass inference. Queued answers and stale choices remain bound to their original question. Customer corrections use `resolve_line` and preserve other requested lines. “Add into the catalog” during a product check adds to the customer list, never the merchant catalog. Product acceptance does not submit an order; the final Confirm request action remains separate.

Missing photos are explicitly labelled in the UI; the engine never invents an image. Actual voice recording/transcription and WhatsApp delivery remain future adapters. This phase accepts text, including eventual transcription output. Its local carousel preview does not itself establish real WhatsApp carousel eligibility or billing.
