# Design audit

21 October 2026. `M p.N` means the mobile PDF's actual page number; `D p.N` means the desktop PDF's actual page number. The printed concept number is one lower for their main screens. Source files and method are recorded in [EVIDENCE.json](EVIDENCE.json).

## Verdict

The visual direction is credible: familiar navigation, task-specific labels, readable lists, restrained blue actions and useful Tamil examples. The greatest risk is **missing functional states (Design Anti-Slop C7)**, followed by workflow structure. No confirmed generic-sidebar, decorative-chart or fake-metric pattern warrants a visual redesign. The example prices and counts are explicitly qualified in the PDFs; they are not being treated as fabricated merchant facts.

Priorities below are proposed implementation priorities. P1 means resolve before shipping the affected workflow; P2 means important validation/polish. There is no evidence of a production incident from the static proposals themselves.

## 1. Mandatory three-pass quoting would add work to routine orders — P1

**Evidence:** M pp.4–6 and D pp.4–6 explicitly separate checking items, entering prices, then reviewing/sending. The pricing pages show disabled progression until facts are complete. This is a confirmed design choice, not a measured usability failure.

**Why it matters:** Staff may already know both the item and its price. A complete order should not require visiting two intermediate screens. A missing unit in one row should not prevent correcting a known price in another. On a phone, each stage repeats substantial headings and list content; on desktop it splits information that is useful side by side.

**Improve:** Use one order sheet with photo, original wording, quantity, selling unit, price and amount. Highlight missing facts inline. A “Resolve 2 items” action focuses the first actual missing field; after completion the same action becomes “Send quote for approval.” Guidance can focus one item at a time within the sheet without creating another state machine. Only actual validation gates sending.

**Preserve:** The deliberate final send, visible total and distinction between quote preparation and customer approval. The October 20 accepted sheet and current quote service already support much of this behavior.

## 2. The check-item screen suggests a catalog-dependent sale and weakens evidence — P1

**Evidence:** M p.4/D p.4 offer “Select product” for switch/socket/MCP/pipe but draw no direct store-item alternative. The eight-line source includes a second plier needing quantity/duplicate review. Original customer wording and photo/reference status are not visible in these rows. These are design/specification gaps; the PDF does not prove the implementation would prohibit manual items.

**Why it matters:** Staff can recognize and supply an item absent from digital inventory. A single forced matching action risks recreating the friction the user explicitly rejected. A similar name cannot prove a duplicate, and a generic image cannot prove an exact variant. The pricing screen's all-blank sample also does not demonstrate preservation of known or suggested values.

**Improve:** Put **Use store item** beside optional catalog search. Retain source wording and reference photo when detaching a suggestion. Use a large expandable image; show “Reference photo” when appropriate. Prefill genuinely available indicative prices as orange editable suggestions; unknown prices stay empty. Resolve the repeated plier explicitly: keep as separate lines, merge only with a deliberate supported decision, or remove the unwanted line. Never silently drop it.

**Preserve:** Real selling units, hard product identity constraints and backend validation. Staff sending a quote confirms those quote facts; it does not automatically publish a verified catalog record.

## 3. Price/stock entry needs an explicit stock and write contract — P1

**Evidence:** M p.10/D p.10 use a shop-price field and a counted-stock field; M p.15/D p.14 extend this to a bulk table. The notes correctly distinguish blank unknown stock from zero. D p.14 correctly includes Choose unit for PVC and says changed rows need valid units. Reserved quantities, count previews, patch semantics and partial-save outcomes are not specified.

**Why it matters:** Suppose 12 pieces are physically present and 3 are reserved. Availability is 9. Entering 9 as the shelf count would understate the shop's stock. Leaving an untouched field blank must not silently clear a known value. Restocking, a walk-in sale and correcting a physical count mean different things. A stale bulk edit may conflict with a reservation made after the table opened.

**Improve:** Show On shelf / Held for orders / Available. Offer explicit tasks: Receive stock, Record walk-in sale and Correct physical count. A quick count field must say it includes held items and preview the result. Use the existing movement ledger and inventory-version guards. Track unchanged, set-value and explicit unknown separately. Save only changed fields and validate only changed rows; an untouched unresolved PVC row must not block a valid switch-price update.

For bulk work, show a short changed-row review and the existing resumable batch receipt. Do not promise all-or-nothing for an operation that commits in chunks. “6 saved, 1 changed elsewhere, 2 remaining” is more useful than a generic failure.

**Preserve:** Unknown ≠ zero; selling-unit resolution for touched rows; existing reservations; the current backend's protection against counting below reserved stock. This is a UI/specification correction, not a claim that the existing backend overwrites reservations.

## 4. Quote preparation is drawn; fulfillment and interruption recovery are incomplete — P1

**Evidence:** M/D pp.2–3 show active orders and next-step labels, pp.6 show send-for-approval, and pp.8 show the pre-takeover chat. No supplied view demonstrates customer-approved packing/collection, quote rejection/expiry, amendments, refund handling, uncertain sending, a failed save or returning control to the assistant. The desktop review on p.15 explicitly excludes such behavioral proof.

**Why it matters:** An order is not finished when staff send a quote. A quote can be saved but not delivered. A customer can change the list while staff edit. A takeover without an equally clear return action can leave the bot paused. The pricing screen suggests draft saving, but its persistence and failure states are unspecified.

**Improve:** Use one stage-specific primary action and explicit exceptional states. Keep “Quote saved,” “Queued,” “Delivered” and “Customer approved” distinct. Show dirty/saving/saved/failed/conflict states only when backed by actual persistence. Retain unsaved input after interruptions and reload the current order deliberately after conflicts. Expose resume-assistant after takeover and preserve global-pause precedence.

**Preserve:** Existing acceptance, payment and stock rules. Customer “paid” is a claim; pay-at-shop is unpaid; readiness requires a physical packing check; collection is recorded after handover. A simplified interface must keep these facts accessible without displaying every control all the time.

## 5. Static clarity does not yet establish small-screen, keyboard or data-scale usability — P1/P2

**Evidence:** M pp.3–5/9–10 show long content and sticky controls; D pp.3–5/14 use large fixed canvases and tables. Both sets acknowledge that device behavior/performance is untested. Current source loads a maximum of 100 orders/conversations per snapshot; product pages are bounded to 25. Current owner labels are largely English; the proposed Tamil UI needs real application localization.

**Risks to resolve:** A soft keyboard can cover the price input/footer. A large top bar and stepper can consume a short laptop's working area. An icon-only plus lacks a visible novice label. Search/counts derived only from loaded rows are not global. Repeated unnamed customer placeholders make the wrong chat easier to open. Contrast, hit areas, focus order and Tamil wrapping cannot be certified from a scaled PDF.

**Improve:** Prototype one real order at 360×640, 390×844, 1024×600 and 1366×768, plus narrow/zoomed layouts and a real phone keyboard. Keep one intended scroll region per task; never remove access to content to enforce a fixed window. Keep readable Tamil/English controls and use a labelled “Add product.” Provide store-scoped server search/pagination/count semantics before claiming complete results. Show an allowed contact label plus a stable short order/customer reference; use actual unread/needs-help state, not decorative blue selection.

## Further decisions by area

| Area | Keep | Refine before implementation |
| --- | --- | --- |
| Today, M/D p.2 | One order action and useful shortcuts. The notes correctly say 8 active is not 8 new. | Make help/ready rows actionable; define overlapping count scopes and loading/stale state. Keep failures that require action visible even when diagnostics move to Settings. |
| Orders, M/D p.3 | Cards on phone, scan-friendly desktop rows, uniform desktop Open actions. | Active/history can remain primary grouping; add simple task filters/sort for waiting approval, packing, pickup and changes. Include date/age for older work and server pagination. |
| Inbox, M/D p.7 | Familiar conversation list, help filter and useful previews. | Distinguish latest speaker, unread, selected and needs-help states. Preserve source language in transcripts. Remember search and scroll on return. |
| Chat, M/D p.8 | One context strip and deliberate takeover. | Show the active order/quote link when several orders exist, reply-window restrictions, delivery status, held bot replies and return-to-assistant. Keep attachments/transcripts accessible. |
| Products, M/D p.9 | Search, recognizable photos and pending facts. | Add useful attention filters, real pagination, clearly labelled Add and an empty/search-failure path. Do not show every pending fact as equally urgent on every row. |
| Product editor, M/D p.10 | Quick routine fields and collapsed rare details. | Show price per unit, explicit Free, reference/verified photo status, price-only save and separate stock tasks. Keep photo/name/aliases entry for new products. |
| Settings, M/D p.11 | Secondary usage, connection detail and explicit global pause scope. | Distinguish owner UI language from customer reply language; server-confirmed pause pending/error/success states; no optimistic “active” after a rejected action. |
| Message examples, M/D p.12 | Clearly labelled, inert previews. | Use actual renderer fixtures where possible, identify sample data and avoid a second fake set of business controls. Keep this secondary. |
| Access, M/D p.13 | Explicit sign-in action rather than invented data. | Distinguish signed out, expired session, forbidden shop, offline and server failure. Label ghost rows as placeholders or remove them; authentication must restore the intended route. |

## Accessibility and platform references

These are implementation checks, not claims that the PDF or current application already fails the standards.

- Aim for roughly 44–48 CSS-pixel daily-use controls as a ShopBot design target. WCAG 2.2 AA's target-size rule is 24×24 CSS pixels with exceptions, rather than a universal 44-pixel requirement. [W3C target size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)
- Keep focused fields visible around sticky controls; prefer fully visible focus as the product standard. [W3C focus not obscured](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html)
- Verify narrow reflow without lost information; genuine two-dimensional tables have a scoped exception, not a blanket exemption for the whole app. [W3C reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html)
- Test the real soft keyboard. The visual viewport can shrink independently of the layout viewport, so `100dvh` alone is not proof of keyboard-safe controls. [MDN visual viewport](https://developer.mozilla.org/en-US/docs/Web/API/Visual_Viewport_API)
- Use semantic controls, useful field labels, visible focus, recoverable errors, image dimensions and URL-backed navigation as review checks. Existing code already contains several of these foundations. [Vercel interface guidelines](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md)

## Interpretation limits

The two-item ₹300 review is explicitly a fictional sample, not evidence that six real order lines were lost. The missing lifecycle and recovery views are coverage gaps, not demonstrated broken backend actions. The independent desktop review's three visual corrections are visible and should be preserved; its own scope excludes the broader behavior examined here. Companion source notes/ZIP were not available. A staff walkthrough is needed before saying this flow is easier.
