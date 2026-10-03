# Owner dashboard and MCP

Primary specifications: ARCHITECTURE.md and RUNTIME-FLOWS.md.

Dashboard includes catalog/draft review, conversational owner input with image/audio upload, change previews, order/quote approval, usage, and provider connection status.

Use Better Auth sessions plus server membership checks. External MCP uses the official TypeScript SDK and its own authenticated client/host flow. Dashboard session auth does not automatically authenticate an MCP host.

Both interfaces call shared services. An external AI host normally performs its own reasoning; the MCP server does not repeat that through our agent model. Backend media calls are metered.

Customer media stays in message records. Owner media can propose drafts. Owner voice edits require exact-target resolution, before/after preview, confirmation, version check, and audit.

Expose an asset-ID upload workflow for MCP clients; attachment forwarding depends on client support. Keep dashboard upload as the guaranteed implemented route.
