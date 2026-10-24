Current inventory/import update: the default Products page has no draft tab. Complete ChatGPT additions and the dedicated Import products flow add canonical inventory directly. Needs attention identifies incomplete inventory facts. Read CATALOG-CHAT.md for the shared 1–200 item import format, agent prompt and 12/15/20 catalog tool counts by grant; see MCP-OWNER-WORKFLOWS.md for owner permissions and up to 40 tools. Legacy staging remains internal for compatibility and photo/edit review.

# Direct product addition and internal diagnostics

## Merchant chat

After an owner has explicitly granted catalog publication, the connected agent can use `catalog_add_product` to publish a complete new product in one action. Required fields are an actual original image/file reference, name, seller price, physical stock and selling unit. Optional enrichment uses the exact domain rules shared with the dashboard, returned by `catalog_context` and available at `catalog://owner/enrichment`. No dashboard model call is made by MCP. The connected host supplies language/image capabilities.

The agent shows the product card and follows owner intent/host confirmation. The selling unit comes from the actual price basis or unambiguous reviewed product context; ask when pack versus piece is unclear. Explicit zero stock is valid. Zero price requires `priceStatus: free`; unknown price/quantity are incomplete work. A single transaction retains original bytes, publishes through existing catalog/inventory services, records an operation receipt and rejects canonical-name duplicates across hidden/published products and drafts. Different variants need distinct names. Exact-name detection is not comprehensive fuzzy duplicate identification.

Use `catalog_prepare` → `catalog_attach_media` → `catalog_review` → `catalog_commit` for existing edits and cleaned-image workflows. Missing new-product facts stay in chat. Retain the original, show the original/cleaned images and obtain the seller's chosen primary image. Marketing/uncertain imagery cannot be primary. Older review-later publication contracts remain compatible; the direct-add tool enforces the complete-product minimum. A delegated agent action is never recorded as independent proof of a human click.

`catalog_get_product` reads an exact edit target; `catalog_check_duplicates` checks canonical names; `workflow_status` retrieves this actor's durable receipt after a lost response. Reuse an operation ID only with identical inputs. Complete additions do not remain in Drafts. Legacy proposals remain available through compatibility routes and existing-product edit review; the default Products page has no new-product draft tab.

Existing grants are unchanged. Publication requires its explicit OAuth opt-in; draft/read connections cannot publish. Refresh the connector tool snapshot after updating. No hard-delete tool is supplied.

## Private developer diagnostics

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

## Integration

This implementation was prepared against source `274e73b` with existing customer-guard migration 46 retained. Catalog chat uses additive migration 47; internal diagnostics uses 48. Compare with the newest integration schema and reconcile numbers before deployment. The artifact includes the earlier chat-publication work reconciled onto the newer customer experience source; do not apply the old migration-46 catalog patch as well.


## Expanded owner MCP

Read MCP-OWNER-WORKFLOWS.md for the owner/order tool matrix, explicit OAuth opt-ins, private conversation summaries and guarded order workflows. Existing catalog-only connections keep their permissions. No schema migration is required.
