# Customer experience improvements — 19 October 2026

The user requested five agents to identify end-customer problems, implement solutions, and deploy the integrated result for later review. This work starts from deployed commit `9b61d8a` / release `preview-a8f33494c7f7` and preserves the existing merchant catalog and customer conversations.

Five parallel workstreams cover conversational CRUD targeting; factual feedback after cart changes; product discovery and clarification; WhatsApp action presentation; and independent customer-journey/recovery regressions. Each workstream must demonstrate a concrete problem before changing behavior. The primary agent owns runtime/prompt integration, verification, publication and deployment.

Keep the experience useful in Tamil, Tanglish and English. Preserve explicit product identity, unknown quantities, measured amounts, version-bound actions, photo confirmation, clear-list confirmation and order submission gates. Improve the existing WhatsApp conversation; unrelated owner-dashboard redesigns and speculative features are outside scope.

Use synthetic fixtures and isolated PostgreSQL schemas for tests. Do not execute historical customer commands or send test messages to real customers. Preserve the production configuration, allowance, data and media. Build/test the final combined source, publish a focused stacked PR, stage an immutable verified artifact, take a fresh private backup, activate, and verify readiness plus data preservation. Fresh-speaker/phone acceptance remains a separate human review.
