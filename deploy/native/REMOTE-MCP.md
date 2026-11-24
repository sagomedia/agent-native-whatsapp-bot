# Remote merchant catalog MCP

Enable the endpoint with `SHOPBOT_MCP_PUBLIC_URL=https://demo.sagoautomation.tech/mcp` in the private VPS environment. The hostname must be the existing public WhatsApp hostname and differ from the protected owner hostname. No new public TCP listener or database credential is exposed. The application continues to listen on loopback behind its existing HTTPS tunnel.

The configured owner, shop and resource bind each OAuth grant. App permissions for catalog edits, publication, private owner reads and order writes determine tool discovery and use. Read [owner MCP workflows](../../docs/MCP-OWNER-WORKFLOWS.md) for the permissions and operations supported.

OAuth uses authorization code + S256 PKCE, public clients (`token_endpoint_auth_method=none`), dynamic client registration, opaque hashed access/refresh tokens, single-use five-minute codes, fifteen-minute access and rotating thirty-day refresh tokens. Refresh-token reuse revokes the grant. No client secret is required. Unknown scopes and incorrect resource/redirect/client bindings fail closed. The SDK serves legacy stateless and current per-request MCP over Streamable HTTP. GET returning 405 after authentication is normal for stateless clients.

The pilot permits HTTPS callbacks on `chatgpt.com`, `chat.openai.com` and `claude.ai`, the exact Meta Muse callback `https://agent.meta.ai/api/hatch/oauth/callback`, and local HTTP loopback callbacks for coding clients. For other providers, configure `SHOPBOT_MCP_REDIRECT_URIS` as a JSON array of reviewed exact HTTPS callback URLs. This adds only those exact URLs; neighboring paths, query strings, account identifiers and lookalike domains remain unapproved. URLs must be canonical HTTPS without credentials, fragments or wildcards; at most 32 are accepted. Removing one prevents new registration/consent for that callback, but does not revoke an already-issued grant: disconnect the corresponding agent in owner management too. Client names are self-reported and escaped on the consent page; the return hostname is displayed separately. Public registration has minute and persisted daily limits. The MCP gate checks authentication before parsing uploads, bounds request size and concurrent exchanges, and rejects unrelated browser origins.

The authorization endpoint is on the protected owner host at `/api/owner/mcp/authorize`. The configured owner authentication and write-origin checks apply. It displays a one-time consent form; a model or bearer token cannot approve a connection on its own. Grant creation and draft changes are audited. Owner controls at `/api/owner/mcp` list and revoke connections. That page and its JavaScript stay behind owner access.

ChatGPT web setup: open Plugins, add a custom MCP server named ShopBot Inventory, enter the public MCP URL, choose OAuth and dynamic/automatic client registration, and complete owner sign-in and consent. Workspace policies may restrict adding custom servers. Install/enable it for the intended conversation. See [official OpenAI instructions](https://developers.openai.com/api/docs/guides/custom-mcp-server).

Claude web setup: add a custom connector named ShopBot Inventory with the same MCP URL. Choose sign-in and automatic client registration, complete the owner consent, then enable it in the intended conversation. See [official Claude instructions](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp).

For Claude Code, add `claude mcp add --scope user --transport http shopbot_catalog https://demo.sagoautomation.tech/mcp`, then use `/mcp` to authenticate. The existing SSH/stdio connection can continue independently.

In Meta Muse, ask it to create a custom connector named ShopBot Inventory with the MCP server URL `https://demo.sagoautomation.tech/mcp`. Use its OAuth sign-in flow and approve the connection from the ShopBot owner account. [Meta Muse connector help](https://www.meta.com/en-gb/help/superintelligence/1687253048996149/)

First account check:

> Use ShopBot Inventory to list three published products and report their actual SKU, selling unit and price status. Do not change anything.

Verify that the intended client completed OAuth, discovered its granted tools and ran the read against the right shop. For a photo issue, use [catalog upload recovery](CATALOG-UPLOAD-RECOVERY.md). Use the [VPS runbook](README.md) for an authorized service change. To retire a connection, revoke its grant and verify further calls fail.

For Composio Custom MCP, approve the exact callback sent by its current DCR request (observed callback: `https://backend.composio.dev/api/v1/auth-apps/add`). Use DCR OAuth with authorization-server discovery, complete owner consent, and verify tool sync plus a safe read. For Gemini web, use “Copy redirect URI” in its connection dialog and approve that entire user-bound URL; do not approve the whole Google callback host. Close/reopen the failed setup to retry automatic registration after deployment. Public-client registration still uses `none`, so a client secret is not needed for this flow.
