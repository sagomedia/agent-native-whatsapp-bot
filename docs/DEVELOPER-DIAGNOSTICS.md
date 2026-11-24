# Private developer diagnostics

This is a separate internal stdio MCP process, never part of the public merchant HTTP server. It is suitable for Codex or another locally configured MCP client. ChatGPT cannot directly connect to a stdio process; a separately authenticated private HTTPS adapter would be required for that host. Do not expose this process through the customer connector or borrow customer credentials.

Provision a dedicated operator database connection and a private environment file outside the repository:

```text
SHOPBOT_DIAGNOSTICS_DATABASE_URL=postgresql://dedicated_operator@localhost/shopbot
SHOPBOT_DIAGNOSTICS_STORE_ID=<authorized shop UUID>
SHOPBOT_DIAGNOSTICS_ACTOR=<real operator identifier>
SHOPBOT_DIAGNOSTICS_ALLOW_SAVE=false
```

For a client configuration, use `node dist/apps/server/src/mcp/diagnostics-stdio.js` from a built application, or `npm run --silent mcp:diagnostics` from the source directory with that environment. Set `SHOPBOT_DIAGNOSTICS_ALLOW_SAVE=true` only to expose private report saving. The process never calls a model API, reads arbitrary files, starts a network listener, writes orders/products or sends messages. The database role needs SELECT on stores, conversations, messages, provider_attempts, order_requests, tool_receipts and whatsapp_outbox; SELECT/INSERT on developer_diagnostic_snapshots; SELECT on developer_diagnostic_reports and INSERT there only for report-saving deployments. No UPDATE/DELETE grants on business tables are needed. Local process/configuration access is the trust boundary.

Ask the connected agent: “Review customer problems from the last seven days and save a private developer report.”

1. `diagnostics_collect` calculates retained-record counts and creates a bounded private case snapshot. An interval is limited to 31 days. Page using `nextCursor` and preserve the original cutoff.
2. `diagnostics_get_case` returns minimized, paginated messages, observed provider failure codes, order states, release fingerprints and retained successful-tool receipt counts. It excludes raw provider responses. Receipt counts are explicitly conversation-lifetime rather than time-bound because that ledger has no timestamps. Missing MCP selection telemetry is disclosed.
3. The connected model analyzes the evidence. `diagnostics_save_report` saves the requested private analysis with validated snapshot/case/message references. Model findings remain unverified analysis; no fake “reproduced” flag is accepted.
4. `diagnostics_get_report` retrieves the same operator/shop's saved report. Retry the same operation ID and inputs to recover an interrupted save.

The collector performs deterministic aggregation; the host model writes narrative summaries. This is not a scheduled background analyzer. Counts cover retained application records, not an entire private ChatGPT history or deleted/unrecorded messages. Cases and execution state are read at the documented observation time. Sampled case analysis must not be described as a complete audit. Redaction minimizes common phone/email/account/token patterns but does not guarantee anonymity of free text. Follow the deployment's retention/access policy for these private tables too.

Reports never enter customer response generation. The workflow distinguishes suspected bugs, missing products, aliases, UX gaps, missing tools, delivery failures and intended restrictions. No external GitHub/Slack/email delivery, automatic fixes or deployment actions are included.
