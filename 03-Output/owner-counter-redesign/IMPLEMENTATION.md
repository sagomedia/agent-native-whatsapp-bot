# Owner counter and bulk shop facts

Implementation linked to issue #34. Customer usability sessions remain scheduled for 19 October; no customer sessions are claimed by fixture tests.

## Owner workflow

Today opens with actual active work, assistance requests, checkout visibility, catalog exceptions and read-only message operations. Orders retains the `view=requests` route and existing controls in a selected-order pane. Mobile uses an order list/detail transition with focus restoration. Conversations, Products, settings/usage and message review remain reachable. Quote edits survive in-app navigation; changed order revisions are marked stale and cannot be sent without review. Payment, approval, packing and collection remain separate states.

The design uses actual order contents and product photos, a restrained forest/neutral palette, compact rows and explicit next actions. [Design research](DESIGN-RESEARCH.md) records the Shopify order-view and Zoho import-preview patterns adapted to this shop.

## Actual price and stock updates

Products → **Update prices & stock in bulk** exports all matching products across server pages (up to 3,000), with blank editable fields. It does not export indicative prices into actual-price input cells. Supplied INR amounts and physical on-hand counts require explicit confirmations; blank means unchanged and zero is explicit. Stable SKU, unit/name and catalog/inventory versions prevent silent mapping changes. Existing review-later visibility and unrelated merchant verification fields remain intact.

Upload creates a durable, 24-hour, versioned preview with row errors and before/after values. It does not change product facts. A preview containing any validation error cannot be applied. Apply commits up to 50 source rows atomically, respecting reservations through the existing count ledger. A stale next chunk is blocked without undoing earlier receipts. `(batchId, fileHash, expectedChunk)` binds retries: replaying a confirmed chunk returns its receipt without repeating stock movements. Full paginated receipts can be downloaded. Explicitly supplied actual prices replace indicative display; stock-only changes preserve indicative metadata.

Migration 38 adds `catalog_fact_batches`; current merchant data is not rewritten. Proposed columns from the approved plan are now implemented: `sku, product_version, inventory_version, product_name, selling_unit, shop_price_inr, price_status, confirm_price, on_hand_quantity, confirm_stock, note`.

Owner routes require existing authentication/origin checks:

- `GET /api/owner/catalog/facts/export` with current product filters.
- `POST /api/owner/catalog/facts/preview` with `{csv,filename?}`.
- `GET /api/owner/catalog/facts/batches/:id?cursor=&limit=`.
- `POST /api/owner/catalog/facts/apply` with `{batchId,fileHash,expectedChunk}`.

The compiled `import-shop-facts.js` provides export/preview and one explicitly authorized apply chunk. The explicit chunk index must be retained after an uncertain result. Do not generate physical stock counts or treat suggested prices as merchant approval.

## Read-only operations and demo evidence

`GET /api/owner/operations/summary` returns store-scoped counts for current pending work, relevant send states, recent failures, historical failures and active catalog gaps. Current send issues match operator revision; old terminal failure records remain historical. Raw customer messages, recipients and provider errors are not exposed by this summary. No retries or customer notifications are triggered by reading it.

Attempt costs are counted once, including retries and unresolved charges. Per-order cost and server receipt-to-useful-reply latency are explicitly unknown where persisted evidence is insufficient. Existing WhatsApp timestamps are not relabelled server timing. A subsequent instrumentation change can add receipt-stage timing once the desired measurement is defined.

`npm run demo:evidence -- /private/reviews.json /private/report.json [--database]` produces private JSON/Markdown evidence, retaining failed, abandoned, no-order, fixture and not-executed cases separately. Database inspection is read-only and optional. This report does not weaken or satisfy the existing real-merchant 20-completed-request production pilot gate.

## Remaining input and work

No actual shop price/count sheet is invented or applied by deployment. The 12 missing photos and paint selling-unit hold need reviewed assets/facts. The first customer session and its failures determine targeted recognition/copy repairs and the expanded held-out voice set. Realistic concurrent-customer load evaluation and automatic payment reconciliation remain distinct later work, as does Jev.

Validation and deployed artifact evidence are recorded in the release completion receipt after checks finish. Automated checks use isolated local schemas and synthetic browser records; no paid inference or real customer messages are used.
