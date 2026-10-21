# Make orders and inventory easier to finish

## User direction

The owner reports that the deployed redesign looks better but makes ordinary work harder to understand and complete. The request is now research and alternative designs for review. This package changes no application code, production configuration or merchant data.

The intended user is a hardware-shop owner working at a counter, with desktop and phone access. Success is finishing a quote, preparing an approved pickup, or recording stock without learning the application's internal state machine. Retain product photos and original customer wording. Preserve customer approval and accurate stock/payment facts through system logic and contextual actions.

## Accepted direction and viewport rule — 20 October 2026

The owner selected **A, the order sheet**, describing the attached version as solid. Preserve that visual direction; the supplied reference is saved as [approved-order-reference.png](images/approved-order-reference.png). The remaining layout requirement is explicit: the whole application fits the browser window. The owner permits scrolling inside sections such as orders or items and does not want the entire site moving vertically.

- The application shell fills the available viewport height and width. The document itself has no vertical or horizontal scrolling.
- Navigation stays in place. The order queue scrolls independently, with its search control remaining visible.
- The selected order's title and context stay above the item area. The total, Save draft and main action stay below that area, visible without scrolling to the end of an order.
- Only the item/packing region scrolls for a long order. Desktop column headings stay visible within that region. Opening the original request or focusing an off-screen field reveals it within the region.
- Stock product lists and stock task content scroll inside their own panels. On narrow screens, the product picker and selected task share the available space one at a time, with a visible way to switch between them.
- Resize the working regions when the window changes. Preserve readable text and usable controls; do not shrink every item to force all rows onto one screen. Do not hide required work to remove a scrollbar.

The clickable prototype follows this rule. The subsequent actual dashboard implementation is documented in [the order UX implementation](../order-ux-review-20261020/IMPLEMENTATION.md). This concept package itself has no live connections.

## Why the current experience is difficult

These findings come from the deployed implementation's source and its browser screenshots; they are hypotheses grounded in the interface, not measured usability-test results.

| Current behavior | Cost to the owner | Proposed correction |
| --- | --- | --- |
| A line accumulates checks for identity, quantity, unit, price and other flags. | The owner must interpret multiple validation rules to finish a familiar task. | Describe the actual work: “Choose which switch” or “Enter the unit price.” Count affected items, not technical checks. |
| Required manual/free/duplicate controls are in the three-dot row panel. | The next required action is hidden while sending appears blocked. | Show the missing decision directly in its row. Keep uncommon, optional actions in a menu. |
| Every matched product still looks editable in many ways. | Routine orders require repeated scanning and can lose a catalog match when a unit/name is edited. | Display confirmed facts as readable text; deliberate Edit/Change actions open the relevant field. Keep quantity and price efficient to edit. |
| Quote, advance, acceptance, stock reservation, packing and cancellation occupy one summary. | The owner has to distinguish several independent workflows at once. | The order stage selects one main action. Payment and exceptional stock issues appear when relevant. |
| Inventory movements sit inside the product editor behind an action dropdown and further disclosure. | Receiving stock or correcting a count feels like editing a catalog record. | A dedicated Stock page offers visible Receive stock, Record walk-in sale and Correct count actions. |
| The phone header/navigation uses much of the initial viewport. | The item being worked on is difficult to reach. | A compact detail header and one bottom action put the order or stock item first. |

## Research and what applies here

- [Shopify: draft orders and invoices](https://help.shopify.com/en/manual/fulfillment/managing-orders/create-orders) treats preparing an order and sending it to the customer as a coherent workflow. Apply the task separation, not Shopify's payment-to-order rule: ShopBot still requires its own explicit customer submission and approval.
- [Square: fulfill orders](https://squareup.com/help/us/en/article/6923-pickup-orders-on-square-point-of-sale) uses direct fulfillment actions such as In progress, Ready and Picked up. Apply familiar action language and a clear next action for the current stage.
- [Shopify: inventory states](https://help.shopify.com/en/manual/inventory-and-locations/fundamentals/inventory-states) distinguishes physical stock from quantities committed to orders and quantities available to sell. In ShopBot, expose the relevant existing facts as On shelf, Held for orders and Available. These labels do not change reservation or collection behavior.
- [Zoho Inventory: packages](https://www.zoho.com/us/inventory/help/sales-orders/packages.html) starts packing from a confirmed sales order and populates its items. Apply this to show a packing view when the order is ready for that work, rather than showing a quote editor during packing.
- [NN/g: reduce cognitive load in forms](https://www.nngroup.com/articles/4-principles-reduce-cognitive-load/) emphasizes structure, clear requests and useful support. Apply visible task-specific corrections, prefilled known facts and consistent action placement. Hiding a required correction is not helpful progressive disclosure.

These products provide workflow references. They do not establish that the proposed ShopBot designs are usable; the owner's task walkthrough is the next acceptance gate.

## Shared visual and interaction brief

Use the existing ShopBot blue #2563EB for the main action, text #20252B, page #F4F6F8, white #FFFFFF and borders #D9E0E8. Amber #9A5800 identifies an actual unresolved decision. Use the established readable sans-serif family with 14–16px working text. Avoid decorative charts, extra KPI cards, more verification checkboxes and a permanently competing action sidebar.

The concrete reference order is #8C1CE with eight lines: PVC pipe (2 × ₹245), unspecified switches (2, needing a product choice), PTFE tape (2 × ₹35), clamps (4 × ₹12), M-Seal (1 × ₹45), pipe cutter (1, needing a price), measuring tape (1 × ₹95) and gloves (1 × ₹60). The six priced lines total ₹808. Selecting a ₹35 switch and entering ₹180 for the cutter produces ₹1,058. All people, quantities and prices in concepts are synthetic. The reference inventory item has 12 pieces on shelf, 3 held for orders and 9 available. Receiving 6 changes the preview to 18 on shelf, 3 held and 15 available.

### A — Order sheet (recommended starting point)

A small order queue leads to one wide readable order sheet. The owner sees product, requested quantity, unit price and amount. A long order scrolls within its item area while the order header and bottom action remain visible. Only the two unresolved rows show prominent actions: Choose product and Enter price. The bottom action is Resolve 2 items, which takes the owner to the first actual decision. After resolution, that same location becomes Send quote with the complete total. No repeated verification of known catalog facts.

After sending, show the sent quote and customer-approval status. After approval, show the stock acceptance action, then a packing list. A single final packing confirmation remains at the point of marking ready. Pickup uses Mark collected. Payment confirmation remains an independent fact/action when needed. Destructive changes and customer amendments keep their consent requirements.

Tradeoff: efficient comparison and bulk pricing, but still a table; a novice must scan several items.

### B — Guided review (alternative)

An order opens directly on the next ambiguous item with its requested wording and a short list of catalog choices. Known items stay visible in a compact read-only order list. Choosing a product pre-fills its established unit and verified price; an unknown rate asks for the rate directly. The owner can return to any earlier item. The main button advances to the next unresolved item, then sends the quote from the final complete summary.

Tradeoff: less scanning and clearer decisions on a phone, but more navigation. This should not force a wizard for already complete orders or for an owner entering many prices.

### Stock — a task page shared by both directions

Find a product, see its physical/held/available quantities, then choose a visible task. Receive stock asks how much arrived. Record walk-in sale asks how much was sold. Correct count asks for the actual total on the shelf, including held items. Each shows the resulting stock before saving. Held stock is calculated by existing orders and cannot be typed over.

For example: Receive 6 → On shelf 12 → 18, Held 3 → 3, Available 9 → 15; action Save 6 received. The form should preserve history without requiring the owner to enter unrelated publishing confirmations. Unknown shelf stock remains Unknown, rather than becoming zero.

## Completion rules for a later implementation

1. Known catalog facts require no redundant confirmations. Exact identity, selling basis and price must actually be verified before prefill is treated as authoritative.
2. Every blocker names the missing decision and exposes its correction in context. An opaque disabled button is not the only explanation.
3. Quantity changes use the selected selling unit. Ambiguous packs, loose measures and possible duplicates ask only the relevant question; no automatic merge/conversion.
4. One dominant action follows the order stage. Draft save/recovery and concurrent-edit protection remain, with truthful saving status. Reliable autosave is a separate implementation decision, not an invented mockup promise.
5. Checking an order does not reserve stock. Merchant acceptance reserves it, collection deducts it, and cancellation releases it under the existing rules.
6. Customer changes, short stock, failed delivery and expired quotes retain actionable recovery paths. They must not appear as successful completion.

## Review before implementation

Use the same tasks on both concepts: finish an order with a product ambiguity and one unknown price; prepare an approved pickup; receive 6 pieces; correct a shelf count without changing held stock. The owner should be able to name the next action without instructions. Record hesitations, wrong actions and whether the task completes. Compare task completion before polishing appearance further.
