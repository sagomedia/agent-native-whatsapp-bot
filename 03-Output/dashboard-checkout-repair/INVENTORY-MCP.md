# ShopBot inventory MCP

**Server:** `shopbot_catalog` in local Codex configuration.

**Scope:** the existing shop on the VPS. SSH stdio; no new public endpoint. A dedicated database role reads inventory and writes unpublished proposals. It cannot update published products or access orders, payments or spending budgets.

| Tool | Use |
| --- | --- |
| `catalog_inventory` | List real inventory; follow `nextCursor` with `afterSku`. |
| `catalog_search` | Find products by name, SKU or aliases. |
| `catalog_drafts` | Read unpublished proposals and current versions. |
| `catalog_propose` | Create a draft with stable batch/item IDs. Add `base: {sku, version}` for an existing product. |
| `catalog_edit_draft` | Edit a draft using its current version. |
| `catalog_stage_photo` | Attach JPEG/PNG bytes to a draft; refresh its returned version. |

**Workflow:** read inventory → propose → stage exact photo → review in Products → Drafts → owner publishes. Uncertain images and missing prices remain flagged.

Example request to Codex:

> Use shopbot_catalog to find existing SKUs, then prepare drafts from this product file. Keep merchant prices and stock unchanged unless the file supplies verified replacements. Stage the exact photos and report drafts needing review.

**Connection files**

- Local wrapper: `/home/gk-pc/.local/bin/shopbot-catalog-mcp`.
- Codex entry: `/home/gk-pc/.codex/config.toml`.
- VPS launcher: `/usr/local/bin/shopbot-catalog-mcp`.
- Private VPS environment: `/etc/shopbot-catalog-mcp.env`. Never copy its password into a prompt or Git.

After a new server is added, reconnect MCP servers or start a new chat so the tool list refreshes. Check registration with `codex mcp get shopbot_catalog`.

If SSH access expires, run this in your terminal, enter the key passphrase there, then reconnect:

```sh
/home/gk-pc/.local/bin/shopbot-mcp-unlock
```

The helper reuses or restarts the dedicated agent and unlocks the existing key for two hours. Keep the passphrase out of chat. The MCP wrapper reports locked access and exits; it never requests a passphrase through a tool.

[Official Codex MCP configuration](https://learn.chatgpt.com/docs/extend/mcp?surface=cli).
