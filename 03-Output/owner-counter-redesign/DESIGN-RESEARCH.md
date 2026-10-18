# Owner dashboard research — 18 October 2026

The existing ShopBot dashboard has useful transaction controls and product-specific language. Its main usability limitation is equal visual weight and long expanded order forms, rather than missing decorative elements. The new design puts order work first, keeps detail controls in a selected-order pane, and brings catalog exceptions and import preview into the normal Products workflow.

## Sources

- [Shopify: searching and viewing orders](https://help.shopify.com/en/manual/fulfillment/managing-orders/viewing-orders/searching-orders). Adapt task-based order views and a scannable list with details accessible from the chosen order. Keep payment and fulfillment as distinct facts. We are not implementing Shopify branding, account features, or unsupported sales statistics.
- [Zoho Inventory: items and importing items](https://www.zoho.com/in/inventory/help/items/items-overview.html). Adapt stable SKU mapping and a visible preview/count/error stage before applying a file. ShopBot uses stricter frozen versions, separate real versus indicative prices, and its existing stock movement ledger.

## ShopBot visual direction

Use the actual order worklist as the primary content, dense readable inventory rows and honest empty/error states. Retain the forest/teal identity, cool neutral surfaces, local Tamil font and accessible text. Amber indicates an issue requiring action; it is not decoration. No fabricated revenue, charts, names or trend indicators.

Daily work: Today / Orders / Conversations / Products. Settings and message review remain reachable. Existing URLs, controls, draft protection and transaction state rules must continue working on phone and desktop.
