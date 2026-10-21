# ShopBot convenience and stock plan

Review date: 16 October 2026. Scope: the three supplied screen recordings and the current local source at `2c90ece1e036fdcd390827587fa592c342c4a660`. Recommendations only; no application, inventory or VPS changes were made during this review. The recordings contain no audio track, so the spoken requests cannot be independently checked.

The current flow now reaches a real submitted order, QR and owner preparation. Keep the existing architecture and concentrate the next work on consistent product facts, stock accounting and fewer repeated interactions.

## What the recordings establish

| Evidence | Finding |
| --- | --- |
| `06-22-56`, about 16–40 seconds | The five-item product review is sent repeatedly while M-Seal and cutting-wheel counts remain unresolved. The exact voice content is unavailable. |
| `06-22-56`, about 40–56 seconds | The compact estimate and QR appear. The subsequent owner quote returns to a long text bill. The initial known subtotal is ₹1,210; the later complete quote is ₹1,570. The added amounts need an explicit explanation. |
| `06-22-56`, start; `06-28-24`, about 16 seconds | Customer and owner share order reference `C772B9C3`. Owner Active shows one Preparing order. The previous order-creation/dashboard issue is not reproduced in these recordings. |
| `06-28-24`, about 16 seconds | Accepted order contains `1 litre` for a product named `TEST - Asian Paints ... Paint 10L`. This requires confirmation of the selling basis, not an assumed conversion. |
| `06-28-24`, about 24 seconds | Product list also shows a `10kg` paint title priced and stocked per litre. The screenshot establishes a data inconsistency; it does not establish the merchant's intended unit. |
| `06-24-49`, about 32 seconds | Large product cards dominate the owner conversation and duplicate quantity warnings. The useful five-item customer list is collapsed below them. |

## Implementation order

### 1. Make pack, price and stock units agree

Reuse `sellingPolicy.packContents`, the selling-unit enum and quantity evidence already present. Store the merchant-confirmed selling basis explicitly: sealed pack versus measured/loose sale. Price and stock must refer to that same selling unit.

- A sealed paint can: **1 can × 10L**, price per can, stock in cans.
- Loose paint: **1 litre**, price per litre, available volume in litres.
- A 90g M-Seal pack: **1 pack × 90g**. Do not confuse pack content with purchase count.

Add an owner preview sentence: “Customer buys 1 can containing 10L; charged ₹X; stock decreases by 1 can.” Require confirmation when title, structured pack details and selling unit disagree. A title is a warning signal, not authoritative conversion data. Apply the same validation to direct publishing, MCP-draft publication and owner order quotes. Keep an explicit unlisted/manual line when the owner cannot bind a quote to a catalog SKU.

Audit existing products and surface conflicting rows in a Needs review filter. Do not rewrite existing orders or convert legacy stock automatically. A correction to an active order uses the existing revised quote and customer approval.

**Done when:** the paint example displays the same confirmed unit on its card, estimate, owner quote, pick list and stock movement. Unknown values remain visibly unknown.

### 2. Connect order fulfillment to stock

Current checkout checks recorded stock. Current owner acceptance/collection changes order status but creates no reservation or stock deduction.

Add an inventory movement ledger and order-line reservations. Use the existing owner transactions and audit records, with product rows locked in a stable SKU order.

| Action | Inventory effect |
| --- | --- |
| Browse / draft / estimate / customer submission | No stock movement; availability is provisional. |
| Owner accepts an order | Recheck current availability and reserve all tracked lines atomically. |
| Owner marks ready | Keep reservations; do not deduct again. |
| Owner marks collected | Reduce physical on-hand stock and consume each reservation exactly once. |
| Reject / cancel before collection | Release reservations exactly once. |
| Accepted amendment | Adjust reservation differences atomically against the approved revision. |
| Restock / walk-in sale / correction | Record quantity, reason and actor; respect stock already reserved. |

Show **On hand / Reserved / Available** separately. Available = on hand − active reservations. Unknown stock remains untracked until the merchant enters an opening balance. Use exact fixed-unit quantities for measured sales, rather than floating-point subtraction; the current integer stock field needs a deliberate migration for fractional stock. Returns after collection require an explicit return movement; cancellation must not silently restock sold goods.

Do not deduct past orders on deployment. Reconcile existing open orders explicitly before giving them reservations. Keep payment recording independent: collection does not prove payment, and a payment callback does not deduct stock.

**Done when:** two owners accepting the final unit concurrently cannot both reserve it; retries cannot double-deduct; cancellation releases it; unknown stock never becomes zero by inference.

### 3. Ask only for information still missing

Keep confirmed products in the cart. Ask focused questions such as “M-Seal எத்தனை pack வேணும்?” with buttons **1 pack / 2 pack / வேற count**. Capture multiple counts in one reply when their targets are clear. Resolve “one each” against the clear current scope; ask if its scope is ambiguous.

Do not resend all five photos for an unchanged quantity question. Reshow a photo when identity/variant changes, the customer asks to see it, or at the final product review. Explain lack of progress after repeated unclear answers and offer a focused choice while preserving the cart.

Separate identity/pack confirmation from price and availability freshness. Keep concurrency versions for writes; do not simply remove version checks. Stock-only changes should trigger an availability check, not force customers to approve the same photo again. Identity checks must still cover photo, variant, pack contents, selling policy and quantity step.

**Done when:** changing one item's count keeps other selections; a stock adjustment does not resend unchanged product galleries; a different pack still needs confirmation. Generic “சரி” never silently submits an order.

### 4. Use one bill format from estimate through final quote

Reuse the current invoice renderer for the owner final quote. Preserve its current quote ID, revision, delivery evidence and bound approval action.

- Label **Estimate — incomplete prices** separately from **Shop final bill — approval needed**.
- Explain the transition in this recording: “Earlier known items ₹1,210; newly priced items ₹360; final total ₹1,570.” Derive that explanation from actual line differences.
- Include pack/count, rate, amount, verified advance and balance in the image; keep accessible text.
- Attach **Bill சரி** and **Bill மாற்றணும்** to the final page. Offer shop assistance as a separate secondary route.
- After approval, show the approved total and preparation status. Remove the blanket “price may change” warning from an approved final bill. Any later change still requires a new quote and approval.

**Done when:** estimate and final quote share a readable layout, the total change is explained, stale approval is rejected, and multi-page quotes retain ordered delivery.

### 5. Make the owner's next action obvious

Keep Active / Checkout / History. Within an order, show the actual blocker and next action: **Resolve 2 items → Customer approval → Accept & reserve → Pack → Ready → Collected**. All-known orders can go straight to acceptance after a fresh availability check.

Add a compact pick list with photo thumbnail, confirmed pack/count and stock availability. Allow the owner to confirm that all items were physically packed; shortages go through the existing amendment/quote flow before marking ready. Show payment status alongside, with a separate actual cash/UPI receipt action for pay-at-shop orders.

In Conversations, promote the current cart/order summary and next unresolved item. Collapse repeated historical galleries; allow invoice/photo enlargement. Keep the existing calm visual style. In Products, add quick Restock / Record sale / Correct count actions so a stock update does not require editing the entire product.

**Done when:** an owner can identify a blocker without opening chat, prepare the correct pack, and see whether the ready notification was queued, delivered, failed or unavailable.

### 6. Make verification and recovery less repetitive

Persist verification per fact with its confirmed value, actor and time. The current product editor resets all five checks when opening/changing a product. Invalidate only affected facts: changing a photo needs a photo review; changing stock needs a stock check; changing the selling unit also invalidates the price/stock basis.

Keep payment facts strict: Pay at shop is unpaid; “Pay பண்ணிட்டேன்” is only a claim; manual verification requires checking the actual receipt. Show delayed/failed media and notification recovery in the owner dashboard without blindly resending an uncertain message or asking the customer to start again.

Use the existing outbox, notification deduplication and version guards. Add a bounded recovery view for stuck invoice/quote/notification groups and refresh their current controls safely. Avoid introducing a second messaging pipeline.

**Done when:** an ordinary restock does not require re-verifying an unchanged photo/name; failures have a specific recovery action; retry does not create a duplicate order, payment or message.

## Keep the current bot consistent

Implement in small reviewable changes: **unit validation → stock ledger/reservations → focused questions → final invoice/status → owner conveniences**. Verification metadata and recovery can accompany their affected features.

Reuse existing tools, selling policies, quote/amendment consent, invoice renderer and WhatsApp outbox. AI interprets Tamil/Tanglish requests and suggests catalog matches. Deterministic code owns quantities, conversions, prices, stock, payment facts, consent and status transitions.

Each release retains current carts, active order revisions, advance records and the approved demo pay-at-shop option. Refresh the deterministic Tamil review page for changed customer copy. Validate inventory changes on an isolated database before enabling them for the demo shop.

Required regression scenarios: 10L sealed can versus loose litre; 10kg versus litre conflict; one pack versus 90g content; two buyers competing for the last unit; repeated acceptance/collection/cancellation; amendment reserve increase and decrease; unknown stock; fractional sale and restock; stale quote; delayed final-page delivery; unchanged-photo confirmation after a stock edit; receipt claim without settlement; and a network retry after an uncertain write.

## Source anchors

Paths below are relative to `02-Build/shopbot-ai/`.

- `apps/server/src/services/catalog-products.ts:14` — publication checks and current limited weight/volume validation.
- `packages/contracts/selling-units.ts:5` — existing pack-content and cutting policy to extend.
- `apps/server/src/services/tools.ts:424` — stock recheck before submission.
- `apps/server/src/http/owner.ts:249` — owner acceptance has no inventory reservation.
- `apps/server/src/http/owner.ts:266` — fulfillment has no stock movement.
- `apps/server/src/services/order-quotes.ts:30` — manual quote overrides need structured selling-basis validation.
- `apps/server/src/services/order-quotes.ts:38` — final quote currently uses text presentation.
- `apps/server/src/services/visual-ordering.ts:74` — product review rebuilds all cart cards.
- `apps/server/src/services/visual-ordering.ts:193` — status image always describes an estimate and possible price change.
- `apps/server/src/services/product-confirmation.ts:4` — identity currently depends on the product's general version.
- `apps/dashboard/src/OwnerCatalog.tsx:44` — all verification checks reset on opening; line 45 resets them for ordinary field changes.
- `apps/dashboard/src/OwnerDashboard.tsx:55` — primary owner action needs blocker/pick-list context.

Owner UI review also used the [Web Interface Guidelines](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md), particularly specific action labels, explicit functional states and accessible updates. This plan prioritizes observed workflow issues over cosmetic redesign.
