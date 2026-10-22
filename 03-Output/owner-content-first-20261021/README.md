# Owner interface: more working content, less framing

21 October 2026. Implementation of the owner's accepted [content-first plan](../owner-content-space-plan-20261021/PLAN.md), committed at `4f0e8e8`, against functional baseline `d1853a0`. Candidate for draft PR #57 and acceptance issue #52. Not deployed to the VPS.

## What changed

The phone header now has one page title and a labeled Tools button. Shop identity, language, Settings, Message review, last-updated status, privacy information and optional daily-task help remain available in Tools. Offline, permission, channel, budget and save failures remain visible in the working page. The menu supports keyboard containment, Escape and return focus. Desktop keeps its navigation rail and direct language/help controls.

Orders uses a compact stage/search toolbar followed by normal separated rows. Search opens when needed and stays open for an active query, including after reload. The worklist scrolls with the main page; it no longer occupies a small independent scrollbox. The stage and row retain their counts, customer, time, item preview and next-needed state. One-page results have no disabled pagination band; real multiple pages keep Previous/Next. Returning from an order restores the list's position after its asynchronous read completes, with focus on the originating row.

Focused orders, product records and conversations use the phone's bottom space for their own actions. Back and Tools retain navigation. Order totals, unresolved-item guidance, draft state, notification choice, save/send and next fulfillment action remain. The repeated unresolved count in the footer is removed because it is already in the primary action and item guidance. Notification labels are shorter while their accessible on/off names and pressed state remain explicit. Phone actions retain 44px touch heights.

The conversation transcript now fills its available parent height rather than an older viewport subtraction. Supplemental customer/order, observation and draft information is grouped under Conversation details inside the transcript scroller. Original photos/audio, retained history pages, takeover, reply eligibility and delivery truth remain. A return link to the originating order stays directly available.

Products retains the stock table, five record sections, on-hand/held/available facts, explicit publication review, unknown values and recovery controls. The record's redundant global tool row is omitted on phones; Back to inventory and record More actions remain. Today uses flatter task rows; Settings and message previews use fewer perimeter boxes and compact section spacing. Inputs and meaningful exception boundaries keep their outlines.

`owner-content.css` owns the current shell's content allocation and scroll behavior, scoped more specifically than lazily loaded inventory styles. Existing feature files continue to own their business controls. No schema, backend commerce rule, dependency or provider configuration changed.

## Measured result

See `VERIFICATION.json` for exact viewport intersections and all English/Tamil measurements. The baseline is preserved separately in [BASELINE.json](../owner-content-space-plan-20261021/BASELINE.json).

The before figure for Orders was a constrained inner list viewport. The after figure is the available span from the first row to the main viewport's bottom. Rows now flow naturally; a short result set does not stretch to fill that span. Both measurements exclude persistent navigation. These synthetic fixture measurements indicate space allocation, not human task time.

| Working region | 320×640 before | 320×640 after, EN / TA | 390×844 before | 390×844 after, EN / TA |
| --- | ---: | ---: | ---: | ---: |
| Orders worklist available span | 118px | 406 / 406px | 289px | 610 / 610px |
| Order item viewport | 223px | 318 / 308px | 391px | 522 / 522px |
| Conversation transcript viewport | 71px | 373 / 371px | 243px | 583 / 577px |
| General product form above save bar | — | 239 / 224px | — | 449 / 434px |

Orders starts at y=174 in both phone sizes. Three complete standard rows fit at 320px and four at 390px; an additional intercepted long-Tamil-name fixture also fits three/four complete rows. Every accepted content minimum passes. These results include the 22px local preview marker.

[Before short-phone Orders](../owner-content-space-plan-20261021/evidence/order-list-320.png) · [After Orders](evidence/orders-en-320.png) · [Tamil Orders](evidence/orders-ta-320.png) · [Order detail](evidence/order-detail-ta-320.png) · [Conversation](evidence/messages-en-320.png) · [Product record](evidence/product-ta-390.png).

## Validation and evidence

`check-owner-content-space.mjs` checks the accepted minimum spans, complete visible rows, one phone list scroller, active search after reload, 44px order actions, return position after loading, menu keyboard containment/Escape, help return focus, multi-page fixture controls, 800/801px layout transition and a 320×400 reduced-height viewport. API writes are blocked.

The existing suites retain their functional assertions. Their language/help helpers now open Tools on phones; evidence/order navigation opens the new Conversation details group. Waiting for the removed routine footer's visibility is replaced by waiting for its attached shell marker. No commerce assertion was removed. A cached-inventory-style check now verifies that the desktop page title remains visible instead of requiring a redundant subtitle.

Final local results: build/typecheck passed; UTF-8 PostgreSQL **848/848**, zero skips; catalog cleanup **4/4**; 18 content measurements, 36 page layouts, 12 short-phone order/language states, 60 inventory combinations, 18 daily-task groups, eight completeness groups, 11 inner-workflow groups plus 16 inner layouts, full quote browser recovery and actual local API workflows all passed.

Additional evidence covers all six pages, all product sections, English/Tamil labels and order states, quotes/approval/pickup, payment/refund/cancellation, stock holds, unknown facts, publication, inline/bulk/CSV recovery, manual replies and expired access. Actual API writes use only the disposable synthetic local shop, with sending and inference disabled. Build/typecheck, PostgreSQL integration and catalog cleanup results are recorded in `VERIFICATION.json`.

Screenshots under `evidence/` show the production assets. The local synthetic marker stays visible. Prior full process inventory and teaching material remain in [inner workflows](../owner-inner-workflows-20261021/README.md) and [operator guide](../workflow-check-20261021/OPERATOR-GUIDE.md).

## Deliberate tradeoffs and remaining acceptance

Language/help/settings take one extra menu action on phones. Focused records hide the global bottom navigation, making space for the current task; Back and Tools are the alternatives to verify with staff. Conversation details require one expansion. Desktop retains its side-by-side work areas and independent scrolling.

Physical keyboards, phone safe areas, actual enlarged text/zoom, screen readers, older devices/weak networks, native Tamil copy review and a novice/staff exercise remain under issue #52. The reduced viewport and automated keyboard checks are useful checks, not substitutes for those exercises. Live WhatsApp/payment acceptance and release remain separate. No customer send, provider invocation, money transfer, merge or VPS deployment was performed by this implementation pass.
