# Free-tier setup verification — 2 October 2026

Saved key presence confirmed without displaying it. ALLOW_PAID_INFERENCE=false and AI_BUDGET_USD=0 confirmed. Free inference is an explicit CLI opt-in; HTTP simulator remains mock-only.

Implemented persistent project/model guards: three requests per rolling minute; 15-second spacing; 100 per Pacific day; conservative 64K input allowance per bounded text request; one attempt per message; failed/unknown attempts retain quota consumption; no SDK retry/fallback; 15-minute cooldown on 429. Usage above bounds stops further calls for one day. Controls apply to this database, not other applications or independent databases. The account's provider tier remains authoritative; local flags cannot force free billing on an upgraded project. Ledger records free_declared, not a verified zero invoice.

Build/typecheck and all 22 integration tests passed, including quota persistence, daily cap, cross-conversation throttle and sanitized 429 diagnostics. Final Docker image built successfully.

One real synthetic Gemini request was made. Model: gemini-3.5-flash-lite. Conversation: 07bd141a-9497-4a35-b480-ef6ddbd56fb1. Response usage: 416 prompt tokens, 202 candidate tokens, 618 total. The runtime rejected the response before draft mutation; state failed, draft empty, no order request. No paid budget was created. No retry or second generation call was made.

The precise rejection category was not retained in the original implementation. Sanitized failure-code instrumentation was added afterward and verified offline; it does not recover the earlier output. Key/account/model access is established, while whole-list extraction quality is NOT yet verified. Next controlled evaluation must diagnose the JSON/operation/finish contract before WhatsApp integration.

Source references: https://ai.google.dev/gemini-api/docs/rate-limits and https://ai.google.dev/gemini-api/docs/pricing.
