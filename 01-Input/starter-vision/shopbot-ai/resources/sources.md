# Sources and verification

Checked 2026-10-01. References support individual capabilities; the recommended architecture and numeric limits are our engineering choices, not vendor prescriptions.

## Agent and provider documentation

- Vercel AI SDK ToolLoopAgent: https://ai-sdk.dev/docs/agents/building-agents
- Loop limits/configuration: https://ai-sdk.dev/docs/agents/loop-control
- Google provider: https://ai-sdk.dev/providers/ai-sdk-providers/google
- Gemini pricing: https://ai.google.dev/gemini-api/docs/pricing
- Gemini audio: https://ai.google.dev/gemini-api/docs/audio
- Gemini images: https://ai.google.dev/gemini-api/docs/image-understanding
- OpenAI Agents SDK alternative, checked using official OpenAI documentation: https://developers.openai.com/api/docs/guides/agents/sdk
- Google ADK alternative: https://adk.dev/get-started/typescript/

The AI SDK documents tool execution, provider configuration, and explicit stopping conditions. SDK APIs differ by release; pin compatible stable versions. Gemini supports media understanding; actual quality for store photos and spoken product numbers remains unmeasured.

## Supporting components

- PostgreSQL-backed job queue, official project: https://github.com/timgit/pg-boss
- MCP SDKs: https://modelcontextprotocol.io/docs/sdk
- Better Auth/Fastify: https://better-auth.com/docs/integrations/fastify
- Better Auth/Drizzle: https://better-auth.com/docs/adapters/drizzle
- Razorpay Payment Links, official Node SDK: https://github.com/razorpay/razorpay-node/blob/master/documents/paymentLink.md
- Razorpay signed webhook/idempotency guidance: https://razorpay.com/docs/webhooks/validate-test/
- Meta official API collection: https://www.postman.com/meta/whatsapp-business-platform/documentation/wlk6lh4/whatsapp-cloud-api
- Codex AGENTS.md: https://developers.openai.com/codex/guides/agents-md/

The directly attempted Razorpay create-link page was inaccessible; the official SDK's Payment Link documentation was retrieved instead. The Meta Postman webhook page returned no readable body, so exact Graph API/version/media/message schemas must be verified during the adapter implementation; this plan does not claim a completed API integration.

## User evidence

Latest user correction requires engine architecture before onboarding, explicit SDK/agent choices, voice/image database behavior, and affordability. User selected both AI usage billing and customer payments. Earlier transcript is background, superseded where current decisions differ.

No application runtime, merchant export, real 50-product catalog, provider credentials, or measured cost/accuracy result is included.

## Revision 3 review

Official native SDK: https://github.com/googleapis/js-genai
Native function calling: https://ai.google.dev/gemini-api/docs/function-calling
Native usage metadata: https://googleapis.github.io/js-genai/release_docs/interfaces/types.UsageMetadata.html
AI SDK standardization alternative: https://ai-sdk.dev/docs/introduction

Native SDK is now the default for the Gemini-first engine. AI SDK remains a future alternative. Deployment is app + PostgreSQL initially; job consumers run in the app. Combined media/intent and zero/one-call targets are design hypotheses requiring quality/cost checks. Prior references remain evidence of vendor capabilities, not active SDK requirements.
