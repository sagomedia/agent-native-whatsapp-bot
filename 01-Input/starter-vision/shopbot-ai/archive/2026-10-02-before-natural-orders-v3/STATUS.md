# Current status

Updated 2026-10-01. Revision 3: architecture challenged and simplified.

## Completed planning

- Added ARCHITECTURE-REVIEW.md with why, alternatives, tradeoffs, and revision triggers.
- Replaced the default cross-provider agent framework with @google/genai plus an explicit business controller.
- Simplified deployment to app + PostgreSQL; job consumers start within the app.
- Changed normal-turn design to zero/one model calls, with two attempts as the initial configurable ceiling.
- Combined media interpretation and intent where reliable.
- Staged schema/features and specified automatic safe mock startup.
- Preserved owner MCP/dashboard, payments, billing, and the later hardware trial.
- Archived earlier plans as inactive history.

## Actual implementation

No application, compose setup, migrations, populated fixtures, provider adapter, or runtime results exist. This is an improved implementation specification.

## Next action

Start work/queued/001-local-foundation.md. Then 002-text-workflow-and-metering.md produces the first functioning interpreted customer flow.

No merchant export is needed for local engine work. API keys/authorized spend, actual server details, WhatsApp connection, merchant payment test account, MCP host/auth, and real-store data are needed only for corresponding real checks.

SDK compatibility, single-pass media quality, actual cost savings, server capacity, and profitability have not been measured. Do not describe them as proven.
