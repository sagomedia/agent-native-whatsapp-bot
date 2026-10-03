# Minimal owner UI and MCP

Owner auth uses a proven library and store memberships. MCP uses official SDK and selected-host authentication; dashboard sessions do not automatically solve remote OAuth.

Dashboard offers visual draft/image review, change preview/confirmation, orders/quotes and usage. Conversational voice/image tools reuse the controller and shared services.

External owner AI normally calls MCP services directly without our extra inference. Backend media calls are metered.

Customer uploads cannot write inventory. Owner drafts/price-stock proposals need appropriate review/version/audit. Ordinary authorized harmless edits may be simpler; do not remove financial/source protections.

Keep interfaces small; no duplicate backend and no unrestricted SQL/file/payment tools.
