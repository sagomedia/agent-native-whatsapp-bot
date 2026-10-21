# Order review: visible facts and one send action

This change follows the owner's 20 October recording and spoken review. Keep the accepted visual direction and the fixed browser-window layout. Reduce the work needed to quote an ordinary order.

## Owner workflow

1. See the item photo and full name, the customer's original wording, quantity, selling unit and price together. Reference photos are substantially larger and open in an enlarged dialog. Missing photos are identified honestly; the store can still quote the item.
2. Review orange suggestions. Existing indicative prices are prefilled when a positive numeric price is actually available. They are labelled “Suggested · editable”; editing the price removes that suggestion label. Unknown prices stay empty, and an unknown zero never becomes a free item.
3. Change any incorrect detail and choose **Send quote for approval**. This action records the owner's confirmation of the quoted store-item details. Routine product-match and original-request review checkboxes are removed. Missing names, prices, units or quantities are explained beside the affected item, and Send takes the owner to the missing field rather than presenting an unexplained disabled button.

Catalog search remains optional. **Use store item instead** detaches a catalog suggestion while retaining its reference photo; it does not require creating an inventory record. The quote still requires the customer's approval. Catalog identities that the owner deliberately keeps retain current-version, selling-unit and quantity-increment checks. No stock is reserved by editing, saving or sending a quote. Untracked store items use the existing untracked-stock path; tracked stock keeps its existing reservation rules.

The order queue and item region scroll independently. The document stays within the viewport, with the order heading and quote actions visible. Mobile navigation scrolls within its own row rather than breaking labels across lines. Long product names wrap in their editable field.

After customer approval, the main action becomes **Accept order**, then **Mark ready for pickup**, then **Mark collected**. Approved item details are read-only; **Change quote** opens a deliberate revision that still needs customer approval. Payment, amendments and pickup remain available in contextual order details. A customer change that blocks quoting exposes its workflow. Mark ready explicitly confirms the physical packing check instead of requiring a separate packing checkbox. Customer approval, payment receipt, reservation and collection remain distinct recorded actions.

## Automatic updates

Normal owner pages no longer expose Refresh or Test connection controls. Existing background polling remains, resumes immediately on reconnection and preserves local quote edits. An offline or delayed-update notice appears as a small notification; initial authentication/load failures retain their error path. View conversation remains available.

## Scope and validation

Changes are in the actual React dashboard, shared quote-draft validation and owner quote service. No migration or catalog/product-fact edit is required. New optional draft metadata records whether a price is suggested and which catalog photo is retained as a reference.

The synthetic browser acceptance script checks price suggestions, photo enlargement, manual store items, optional catalog selection, direct Send, saved-draft persistence, conflict recovery, customer-approval state, automatic refresh, offline recovery, the approval-to-collection handoff, and independently scrolling items with stationary order controls at five screen sizes. It intercepts all API calls and sends no customer messages. Screenshots are actual browser renders with synthetic orders and existing demo product images.

Focused backend tests cover the manual-item send path, missing facts, unknown prices, explicit free prices, draft concurrency, catalog guards, inventory and reconnection polling. Final regression, release and deployment results are recorded in `VERIFICATION.json` after those checks finish. The owner's walkthrough remains the usability acceptance step; automated checks do not prove the workflow is easy for a new operator.
