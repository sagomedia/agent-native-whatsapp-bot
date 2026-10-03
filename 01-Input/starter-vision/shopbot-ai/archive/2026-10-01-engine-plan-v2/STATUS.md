# Current status

Updated 2026-10-01. Revision 2: reusable engine implementation plan.

## Completed planning

- Selected a concrete recommended stack and component layout.
- Defined customer agent, dashboard owner agent, and external MCP tool execution.
- Specified voice/image pipelines and which database records they create.
- Specified owner change proposals, confirmations, and optimistic concurrency.
- Added AI usage billing and customer payments as separate systems.
- Defined local mock mode, deployment model, milestones, and engine evaluations.
- Archived the earlier onboarding-first plan.

## Actual implementation

No application, Docker Compose file, migrations, provider integrations, or populated catalog has been built. Commands in IMPLEMENTATION.md are required deliverables, not commands that work in this package yet.

## Next

Start work/queued/001-runnable-engine-foundation.md. Build the local API, worker, database, dashboard shell, simulator, seed data, and persistent volumes before requiring a merchant export.

Then implement services and permissions, metering, the text agent, media, owner tools, WhatsApp, and payment/invoice adapters in dependency order.

## Real-integration inputs still needed

Existing server capabilities; API keys and authorized test spend; WhatsApp number/account and provider rates; merchant payment account/test credentials; chosen external MCP host/auth requirements; actual export/software identity; and real product photos/languages/fulfillment settings.

These block only their corresponding live tests. Synthetic fixtures and mocks support engine development now.

No model accuracy, local runtime success, paid payment result, or store profitability has been measured.
