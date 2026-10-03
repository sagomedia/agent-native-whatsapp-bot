# ShopBot AI — reviewed implementation plan

Revision 4, 2026-10-02. This package specifies a reusable retail bot engine; no application is implemented yet.

## Start here

1. NATURAL-ORDERS.md: multi-item natural conversation, confirmation, packing and pickup.
2. ARCHITECTURE-REVIEW.md: why each major choice exists, alternatives, tradeoffs, and when to revisit it.
3. ARCHITECTURE.md: the simplified stack and runtime.
4. RUNTIME-FLOWS.md and DATA-MODEL.md: exact media/action/database behavior.
5. BILLING.md: store usage billing and merchant product payments.
6. IMPLEMENTATION.md and work/queued/: eight ordered implementation slices.
7. outputs/codex-start-prompt.md: begin local implementation in Codex.

## What changed after review

- Start with the official @google/genai SDK for the Gemini-first version; Vercel AI SDK remains an alternative if real multi-provider requirements justify it.
- One application container plus PostgreSQL initially. Durable job consumers run in the app; split a worker only after measured contention.
- Use a controlled business workflow: deterministic events use zero model calls; open text/media usually targets one structured interpretation call.
- Combine media understanding and intent extraction where it works, rather than automatically transcribing/analyzing and then invoking another agent.
- Stage database/UI/payment modules by the feature being built.
- First boot in mock mode must migrate and seed automatically; clean local startup is an acceptance test.
- No claim that changing SDK alone lowers provider token prices or proves matching accuracy.

## Folder organization

Root files define rules, goals, status, choices, and implementation specifications. inbox/ holds unreviewed inputs; areas/ has component notes; work/ tracks queued/active/completed tasks; resources/ contains sources/fixtures; outputs/ contains prompts/evaluations; archive/ preserves inactive revisions.

Build the engine with synthetic records first. The hardware store's 50-SKU trial is later onboarding and evaluation. All user-confirmed features remain in the roadmap, including owner MCP/dashboard, voice/images, usage billing, and customer payments.
