# Remote merchant catalog MCP

Enable the endpoint with `SHOPBOT_MCP_PUBLIC_URL=https://demo.sagoautomation.tech/mcp` in the private VPS environment. The hostname must be the existing public WhatsApp hostname and differ from the protected owner hostname. No new public TCP listener or database credential is exposed. The application continues to listen on loopback behind its existing HTTPS tunnel.

This is the current single-owner, single-shop pilot. Each OAuth grant is bound to the configured owner, shop and exact MCP resource. Client-supplied shop identifiers cannot select another store. A read-only grant exposes the three read tools; adding `catalog:draft` exposes the existing draft/photo tools. Publication, live stock changes, orders, payments, messages and spending controls remain outside this MCP surface.

OAuth uses authorization code + S256 PKCE, public clients (`token_endpoint_auth_method=none`), dynamic client registration, opaque hashed access/refresh tokens, single-use five-minute codes, fifteen-minute access and rotating thirty-day refresh tokens. Refresh-token reuse revokes the grant. No client secret is required. Unknown scopes and incorrect resource/redirect/client bindings fail closed. The SDK serves legacy stateless and current per-request MCP over Streamable HTTP. GET returning 405 after authentication is normal for stateless clients.

The pilot permits HTTPS callbacks on `chatgpt.com`, `chat.openai.com` and `claude.ai`, plus local HTTP loopback callbacks for coding clients. For other providers, configure `SHOPBOT_MCP_REDIRECT_URIS` as a JSON array of reviewed exact HTTPS callback URLs. This adds only those exact URLs; neighboring paths, query strings, account identifiers and lookalike domains remain unapproved. URLs must be canonical HTTPS without credentials, fragments or wildcards; at most 32 are accepted. Removing one prevents new registration/consent for that callback, but does not revoke an already-issued grant: disconnect the corresponding agent in owner management too. Client names are self-reported and escaped on the consent page; the return hostname is displayed separately. Public registration has minute and persisted daily limits. The MCP gate checks authentication before parsing uploads, bounds request size and concurrent exchanges, and rejects unrelated browser origins.

The authorization endpoint is on the protected owner host at `/api/owner/mcp/authorize`. Existing Cloudflare Access JWT verification and owner write-origin checks apply. It displays a one-time consent form; a model or bearer token cannot approve a connection on its own. Grant creation and draft changes are audited. Owner controls at `/api/owner/mcp` list and revoke connections. That page and its JavaScript stay behind owner access.

ChatGPT web setup: open Plugins, add a custom MCP server named ShopBot Inventory, enter the public MCP URL, choose OAuth and dynamic/automatic client registration, and complete owner sign-in and consent. Workspace policies may restrict adding custom servers. Install/enable it for the intended conversation. See [official OpenAI instructions](https://developers.openai.com/api/docs/guides/custom-mcp-server).

Claude web setup: add a custom connector named ShopBot Inventory with the same MCP URL. Choose sign-in and automatic client registration, complete the owner consent, then enable it in the intended conversation. See [official Claude instructions](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp).

For Claude Code, add `claude mcp add --scope user --transport http shopbot_catalog https://demo.sagoautomation.tech/mcp`, then use `/mcp` to authenticate. The existing SSH/stdio connection can continue independently.

First account check:

> Use ShopBot Inventory to list three published products and report their actual SKU, selling unit and price status. Do not change anything.

Then verify draft creation with a clearly labelled unpublished test:

> Prepare one unpublished product draft called “MCP connection test — do not publish”. Leave price and stock unknown, record that this is an integration test, and return the draft ID and owner review link. Do not publish or change existing products.

The account test is complete only when that actual client has finished OAuth, invoked the real tools and produced a corresponding audited result. Local synthetic consent, a successful public metadata request or a configured CLI entry alone is not proof of ChatGPT/Claude account connectivity.

Before activation, take a private database/environment backup and use the normal verified release upgrade. Migration 45 only adds MCP OAuth tables. Existing runtime/stock schema and the six stdio tool contracts remain compatible. This feature introduces no new paid inference, customer message or financial operation. Disabling the environment setting removes the remote routes after restart; revoke grants first if retiring the integration.

Tests: `tests/remote-mcp.test.ts` exercises metadata and host/origin gates, owner authorization, PKCE/code/redirect/resource/client binding, token hashing/rotation/reuse/revocation, scopes, shop isolation, unpublished draft replay, form-encoded token exchange and the official MCP HTTP client through a Host-forwarding proxy. Run the existing catalog, owner authentication, stock, voice/photo, delivery and spending regressions before deployment.

Large hosted-chat photo uploads and bulk status tools are a later addition. The existing photo tool accepts bounded bytes; never claim that a hosted chat attachment can be forwarded until that client's attachment flow has been tested. Draft edit/photo calls return version conflicts after a successful lost response; reload draft/asset state before retrying, as their annotations now indicate.

For Composio Custom MCP, approve the exact callback sent by its current DCR request (observed callback: `https://backend.composio.dev/api/v1/auth-apps/add`). Use DCR OAuth with authorization-server discovery, complete owner consent, and verify tool sync plus a safe read. For Gemini web, use “Copy redirect URI” in its connection dialog and approve that entire user-bound URL; do not approve the whole Google callback host. Close/reopen the failed setup to retry automatic registration after deployment. Public-client registration still uses `none`, so a client secret is not needed for this flow.
