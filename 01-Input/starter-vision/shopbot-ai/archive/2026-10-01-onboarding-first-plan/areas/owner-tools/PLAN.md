# Owner MCP and dashboard

Both interfaces use the same authenticated application services and database. MCP is a tool interface, not a second inventory system.

## Initial owner capabilities

| Action | MCP | Dashboard |
| --- | --- | --- |
| Search catalog and see source freshness | Yes | Yes |
| Upload/review trial import | Preview and apply tools | Preview and apply page |
| Review suggested descriptions, aliases, and images | Structured review tools | Product review page |
| List and inspect order requests | Yes | Yes |
| Confirm, request changes, or decline an order | Explicit state-change tool | Explicit action |
| Review usage and cost estimates | Yes | Yes |

The visual dashboard is especially useful for checking image/SKU mappings. MCP supports conversational actions without requiring the owner to navigate every page.

## Data authority

Catalog enrichment can be owner-managed. Billing-source price and stock follow import/reconciliation rules. Do not let a casual chat silently replace the inventory source of truth.

## Authentication and changes

Authenticate the owner and enforce store-scoped roles in the backend. The customer bot cannot invoke owner tools. Record the actor, affected entity, before/after values, and time for catalog and order changes.

Preview bulk imports and broad changes before applying them. Ordinary authorized edits do not need an unnecessary extra approval loop. Never expose database credentials or unrestricted SQL through customer or owner tools.

Keep tool schemas small and explicit. Example families: `search_products`, `preview_catalog_import`, `apply_catalog_import`, `review_product_image`, `list_order_requests`, `get_order_request`, `confirm_order_request`, and `get_usage_summary`.

The exact MCP client/host and its current connection requirements are open. Develop against a local test client first; verify compatibility with the selected host during integration.
