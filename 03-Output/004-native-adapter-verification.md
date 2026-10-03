# Native AI adapter and spending guards — verification

Verified 2 October 2026. Source: 02-Build/shopbot-ai. Real Gemini inference and WhatsApp messaging remain untested/unconnected; no paid calls occurred.

## Delivered

Pinned official @google/genai 2.26.0 adapter, bounded public context, structured shopping operations and existing strict backend validation. Initial evaluation candidate: gemini-3.5-flash-lite, standard tier/minimal thinking, one candidate, 4096 generated-token cap. SDK retry count is one total request and automatic function calling is disabled.

Migration 3 adds durable store budgets and attempt-level USD rate snapshots/reservations/usage estimates. Product prices remain paise; no exchange rate is assumed. Reservations commit before each generation call. Known confirmation/review/status actions bypass inference. Unknown usage/errors/crashes retain holds; rejected output still accounts for response usage. Rate identity/bounds, store concurrency and budget/reset guards are enforced. Cached replay requires the same provider and source version.

Explicit native:preflight/native:eval commands use local configuration and a separate fixed synthetic evaluation store. A new conversation per run shares the persistent cumulative store ceiling. The CLI smoke covers one five-item list; it does not send customer messages, request payment or confirm the request. The HTTP simulator remains mock-only even if native CLI configuration is enabled.

Implementation/setup: 02-Build/shopbot-ai/NATIVE-AI.md. Official references: [model profile](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite), [structured output](https://ai.google.dev/gemini-api/docs/generate-content/structured-output), [standard pricing](https://ai.google.dev/gemini-api/docs/pricing), [SDK retry semantics](https://googleapis.github.io/js-genai/release_docs/interfaces/types.HttpRetryOptions.html) and [cancellation semantics](https://googleapis.github.io/js-genai/release_docs/interfaces/types.GenerateContentConfig.html).

## Automated results

TypeScript checks, dashboard production build and server compilation passed. Docker Compose built directly from the SMB source and app/PostgreSQL became healthy. npm installation reported zero known vulnerabilities.

Final container command `docker compose run --rm app npm run test:integration`: 18 passed; 0 failed, cancelled or skipped. Ten existing business/foundation scenarios remain green. Eight native scenarios cover:

1. Disabled/missing/invalid configuration and expired rates; exact USD arithmetic including hidden thinking.
2. Actual official SDK HTTP serialization through local fake fetch: JSON schema, standard tier, output cap, minimal thinking and a transient 503 produces exactly one request.
3. A reservation/attempt is visible before invocation; measured usage settles once; known confirmation makes no additional call; reset/budget increase guards hold.
4. Truncation, malformed JSON and invalid privileged operations preserve draft and retain their response cost estimates.
5. Missing usage and network exceptions keep holds through runtime reconstruction; provider error/secret text is withheld from customer replies.
6. Two customer conversations contend for one store ceiling; an insufficient reservation is denied before SDK invocation.
7. Usage above the pinned bounds blocks further spending and preserves the draft/hold.
8. Expired work with a crashed paid attempt records unknown cost and retains its reservation when another call cannot be afforded.

All provider responses were synthetic. Tests use random database schemas, remove only their test fixtures and do not contact a real model. Fake usage of 1000 input, 100 candidate and 20 thought tokens settles 600 micro-USD in these fixtures; this is an accounting test, not an observed live cost.

Preflight with disabled default configuration returned the explicit authorization-required error (expected exit 1). Preflight with a dummy key and a configured $1 ceiling returned configured/model/rate arithmetic and networkCalls=0 (exit 0); it does not validate actual credentials/account access.

## Existing state preserved

After the final app recreation, /health/ready returned ready/mock. The existing simulator still had five draft lines, the same request 3b4fa4ea-6b4c-482a-8738-2bd4a5fbe5b9 at 95000 paise, two prior mock attempts and zero pending work. No draft/history reset occurred.

Read-only inspection of the actual local database showed schema migration 3, zero live provider attempts and zero inference budgets. Runtime configuration showed paidInferenceEnabled=false, keyConfigured=false and budgetConfigured=false. No credential values were displayed.

The previously disconnected SMB share was reconnected through the existing desktop session; authoritative source remains at its original workspace path. No separate replacement project was created.

## Remaining verification and limits

Real account/model access, shopping extraction accuracy, Tamil/English quality, latency, measured usage and actual billing remain pending a local key and explicitly approved USD spending ceiling. The initial rate snapshot expires 1 November 2026. The application reserves a conservative $0.324813 per attempt from full supported input capacity/output cap, then releases consistent measured usage; unknown holds stay until reconciliation. Estimates charge cached input conservatively and are not invoices.

Live evaluation currently has one fixed smoke case; broader cases must be added/measured before real channel rollout. Context caps 200 products/64 KB; catalog retrieval for a larger merchant needs further work. Production channel/owner authentication, tenant database policies, WhatsApp delivery, staff approval/readiness, amendments/new-order lifecycle, payment and financial reconciliation are later milestones.
