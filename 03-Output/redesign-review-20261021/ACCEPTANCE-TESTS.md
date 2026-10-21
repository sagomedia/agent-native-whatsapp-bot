# Acceptance and verification plan

21 October 2026. **Every check below is proposed and unexecuted in this review.** Synthetic fixtures use isolated stores/databases, mocked delivery and invented customer identities. Real phones/staff are separate acceptance evidence.

## Business behavior

| ID | Scenario | Pass condition |
| --- | --- | --- |
| Q01 | Complete two-line order with actual valid prices/units. | Open and send from the sheet without visiting mandatory check/pricing screens; exact current total and one logical quote. |
| Q02 | Eight-line order with four ambiguous items and one quantity/repeated-item concern. | All original lines and IDs remain traceable; only missing facts require work; resolved rows remain intact through pricing and sending. |
| Q03 | Shop can supply an item absent from digital inventory. | Use store item retains source wording/reference photo; staff can enter facts and send without creating/matching a SKU. |
| Q04 | Suggestion has a genuine positive indicative price. | It is orange, editable and distinct from actual shop price; editing changes its suggestion status; missing price is never invented. |
| Q05 | A product has unknown price, then staff type 0. | Unknown stays unknown; zero cannot send as free without explicit Free. Valid paise totals are calculated by the backend. |
| Q06 | One 10 L can versus ten cans; kg/litre and pack/unit variants. | Count, pack specification and selling basis remain distinct; incompatible conversion is blocked or clarified. |
| Q07 | Two plier lines with similar names. | No auto-merge/deletion based only on the name; deliberate supported correction preserves all other lines and appropriate quantities. |
| Q08 | New customer edit arrives while staff have unsaved quote input. | Current-version conflict is visible; input retained; stale send rejected; explicit compare/reload/reapply path. |
| Q09 | Quote draft saved, navigate away/back and reload. | Acknowledged saved values reload; unacknowledged input is not falsely called saved; missing durable state has an honest warning. |
| Q10 | Send response lost after server commit; staff retry. | Same logical operation is reconciled; no duplicate quote/outbound send; unknown state remains explicit when unresolved. |
| Q11 | Quote offered, then expired/declined or changed by customer. | Correct next action/reason; new material quote needs new approval; old snapshot is not silently rewritten. |
| Q12 | Approved order with pay-at-shop; separate advance-required order. | Pay-at-shop remains unpaid without an invented advance gate. Required advance uses existing genuine receipt checks; screenshots/claims do not verify payment. |
| Q13 | Approved/accepted order through ready and collection. | Correct stage-specific actions; packing check retained; reserve/deduct/release happen at existing boundaries and once only. |
| Q14 | Cancellation/amendment after acceptance, including paid/claimed advance. | Explicit existing change/refund path; truthful payment state; existing holds/history retained or released through valid transitions. |

## Product facts and stock

| ID | Scenario | Pass condition |
| --- | --- | --- |
| S01 | On shelf 12, reserved 3; receive 6. | Preview and saved result 18 on shelf / 3 held / 15 available; one audited movement. |
| S02 | Staff count physical shelf as 2 while 3 held. | Backend rejects with an actionable reservation explanation; input remains available for correction; no false success. |
| S03 | Unknown opening stock, then restock/sale. | Correct count is requested under existing policy; unknown is not treated as zero. |
| S04 | Price-only edit, stock untouched/unknown. | Stock and its verification/reservations unchanged; valid price update succeeds independently. |
| S05 | Known stock, empty field and explicit Mark unknown. | Untouched/invalid blank is not an implicit clear. Explicit unknown operation follows supported policy and cannot erase active reservations. |
| S06 | Measured item with fractional selling increment. | Count/movement accepts only permitted precision/increments; amount is not confused with whole-item count. |
| S07 | Switch price changed while untouched PVC unit is unresolved. | Valid touched row can proceed; no unrelated-row global blocker. A touched PVC row needs an explicit valid selling unit. |
| S08 | Two staff members edit price/count; one commits first. | Product/inventory version conflicts are visible; no lost update or reservation overwrite. |
| S09 | Bulk edit interrupted after a committed chunk. | Receipt shows committed/remaining/conflicted rows; retry resumes the same batch; no repeated stock movement. |
| S10 | Filter/page with unsaved bulk rows; a source product changes. | Dirty rows remain visible as pending or navigation is guarded. Revalidation reports the changed product; it is not overwritten from an old page. |
| S11 | Add product and preserve original photo/aliases. | Photo/name/local aliases can form a draft; routine editor does not remove advanced catalog or publication capabilities. |

## Messages, control and access

| ID | Scenario | Pass condition |
| --- | --- | --- |
| M01 | Customer has multiple orders and similar unnamed contacts. | Inbox/chat/order links refer to the intended record; permitted identity and stable reference distinguish contacts. |
| M02 | Takeover succeeds/fails or conflicts with another staff action. | Composer opens only after current server-confirmed control; conflict/error visible; no mixed owner/assistant write. |
| M03 | Return to assistant while shop globally paused. | Global pause remains effective; UI explains scope rather than pretending replies resumed. |
| M04 | Manual send loses acknowledgement; reply window later closes. | Stable send attempt is reconciled; retained text and explicit window status; no blind duplicate or illegal send. |
| M05 | Owner language switched with active quote/reply draft. | UI localizes while preserving input and routing; customer's reply language/transcript is unchanged. |
| A01 | Signed out, expired session, forbidden shop, offline and server error. | Distinct truthful states/actions; no invented data/counts; original route restored after valid authentication. |
| A02 | Refresh fails with existing loaded data. | Show stale status and last successful update; retain input; never display a disconnected write as saved. |
| A03 | Preview message buttons and test-recipient mode. | Preview controls cannot mutate orders/payments/send; test-only access is never labelled general production delivery. |

## Browser, keyboard and layout matrix

Required working sizes for the first pass: **360×640, 390×844, 768×1024, 1024×600, 1366×768 and 1920×1080 CSS pixels**, plus narrow 320-pixel reflow and enlarged text/zoom. These are proposed test sizes, not devices already tested.

- Use a real intended phone/browser with its decimal keyboard open on the last price and stock fields. Verify input, error, subtotal and primary action are reachable; do not infer this from desktop viewport emulation.
- Check notched safe areas, landscape and orientation change. The navigation/footer must not cover the focused control. Keep content available when available height becomes small.
- At ordinary size the outer app remains fixed as requested; the intended list/item/chat region scrolls. At zoom/large text, adapt the layout so the fixed-shell preference never clips required controls or disables browser zoom.
- Tab and Shift+Tab visit fields/actions in a predictable order. Enter in an ordinary field must not accidentally send a quote or apply a bulk stock count. Modal close returns focus to its opener; errors focus the relevant field. All actions have keyboard alternatives.
- Inspect actual hit areas and contrast from CSS. Aim for the larger daily-use target stated in the audit, validate minimum requirements and retain visible non-color status labels.
- Test Tamil names/labels, mixed English models/SKUs, long names, many decimal digits and empty image/name/error content. Display no clipped required facts.
- Screen-reader smoke: name, quantity/unit/price association, error explanation, current navigation, dirty/saving/error status and dialog focus. Do not announce every polling tick as a new urgent alert.

## Data scale and network

- More than 100 orders/conversations: find an old record through server-scoped search/pagination. Compare loaded, filtered and global counts; there must be no false “nothing found” caused by an unseen page.
- 3,000 synthetic products: bounded requests/25-row pages, deterministic pagination and retained edits. This is a scale fixture, not proof of real merchant accuracy or production traffic capacity.
- Weak network, offline, expired auth, response loss and reconnection: no silent loss, success-before-acknowledgement or uncontrolled automatic replay. Polling must not overlap or overwrite active fields.
- On the intended old computer, compare baseline/candidate task completion, request/image bytes, background polling and interaction delays. Record hardware, browser, dataset and sample size. Without that device, leave performance acceptance pending.

## Repository verification

Extend meaningful existing tests rather than duplicating component markup. Relevant foundations include `owner-quote-experience`, `owner-quote-workbench`, `owner-editor-save`, `owner-polling`, `owner-fulfillment`, `owner-facts`, `owner-quick-price`, `stock-reservations`, `inventory-flow` and `owner-catalog-pages` tests.

Use production build/typecheck, focused integration suites on disposable PostgreSQL and the required catalog checks. Run the combined full suite before a release candidate. Browser tests exercise real forms/requests under fixtures and capture layout and focus; mocked business tests cannot establish real WhatsApp delivery or fresh speech recognition.

## Staff walkthrough and release decision

Use the same tasks before/after with intended staff: quote a complete order; resolve one ambiguous/non-catalog line; correct a suggested price; prepare an approved pickup; receive six units; record a price-only update; take over and return a chat.

Record completion, wrong action, requested help, backtracking, time and the staff member's wording. Suggested acceptance goals are unassisted completion, fewer unnecessary steps and no critical business errors; confirm numerical thresholds after the baseline. A small staff sample is formative evidence, not a population-wide usability claim.

Do not activate a candidate with silent wrong units/prices, unintended deletion, lost durable drafts, duplicate mutation, false verified payment/delivery or corrupted holds. Keep smaller wording/layout findings visible in the issue tracker. Preserve source/hosted-check/deployment provenance, backup/restore and code rollback evidence. Live customer testing and activation remain separate authorized steps.
