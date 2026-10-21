# Detailed implementation plan

21 October 2026 · Proposed implementation scope, not implemented changes.

Base inspected: `f3a982747e95e37bbe58e678ea43209b696f5b54`. Recheck the branch and other active work before starting; the source may advance after this review. Findings and page references are in [DESIGN-AUDIT.md](DESIGN-AUDIT.md).

## 1. Target experience

Use the PDFs' familiar four-section navigation and readable content while preserving the accepted order sheet. Phone and desktop share the same business state and task logic; their layout differs. A phone renders readable item cards. Desktop uses an order table and optional worklist beside it. The main action follows the actual order state.

The existing three business-stage labels can remain **Review & quote → Customer approval → Prepare pickup**. They describe progress, not mandatory screens for checking every product, entering every price and reviewing the same list again.

### Order sheet

Header: short order reference, permitted customer label, age/date, state and a conversation link. Keep the customer's original request accessible. Show an unmistakable notice when it changes.

Each row/card contains:

- An inspectable photo with reference/missing status where appropriate.
- Product name and original requested wording; name remains editable when staff quote a store item.
- Count or requested measure, selling unit and any relevant pack specification.
- Unit price, its actual/suggested/unknown status, line total and contextual correction.
- Optional catalog suggestions and **Use store item**; neither requires creating an inventory record.

Footer: total or known subtotal/pending facts, truthful persistence status, Save draft when needed, and one main action. Avoid repeated review checkboxes. A valid quoted store item needs explicit name, quantity, unit and price; a retained catalog identity also keeps its version/increment constraints. A zero rate requires explicit Free confirmation.

Guidance is an in-place focus action. “Resolve 2 items” scrolls the task region to the first missing field and explains it. Known rows remain intact. Completed orders can proceed directly to Send; already approved/accepted orders open in their correct state without re-quoting.

### Primary-action rules

This table describes presentation precedence. The server remains authoritative and the detailed backend states remain separate.

| Condition | Main action and visible explanation | Business effect |
| --- | --- | --- |
| Order changed or saved-draft conflict | Review current version; retain local input for comparison. | No automatic overwrite or send. |
| Pending customer amendment/cancellation | Review customer change. | Use existing amendment decision/quote path. |
| Missing required quote facts | Resolve N items. | Focus a missing field; no mutation by navigation. |
| Quote complete and editable | Send quote for approval. | Save latest draft and submit the version-bound quote once. |
| Quote saved, send failed/unavailable | Follow up in conversation or supported retry. | Retry only through existing delivery/idempotency rules. |
| Earlier delivery uncertain | Check message status. | Do not enqueue a fresh duplicate merely to make the UI look successful. |
| Current quote offered | Waiting for customer approval; View conversation. | Read-only quoted snapshot until explicit revision. |
| Quote expired/declined | Revise quote with the actual reason/status. | Refresh facts and obtain new customer approval. |
| Customer approved, required advance not verified | Check advance receipt. | Record an actual staff-verified receipt through the existing path. |
| Customer approved, known stock short | Review shelf count or revise supplied items. | Do not bypass reservations; untracked store items remain supported. |
| Approved and eligible for acceptance | Accept order. | Existing acceptance/reservation transaction. |
| Accepted, not ready | Mark ready for pickup. | Includes the established physical packing confirmation. |
| Ready | Mark collected. | Record handover and existing stock movement once. |
| Collected/cancelled/rejected | View completed record; contextual next task. | No silent mutation of historical order lines. |

Do not impose advance payment on pay-at-shop orders. Payment claim, verified receipt, fulfillment and refund status remain individually inspectable. Their exact eligibility rules are reused, not inferred from the displayed label.

### Inventory

Show On shelf / Held for orders / Available, with unknown values explicit. For a known shelf count, availability equals on hand minus reserved. Stock changes use Receive stock, Record walk-in sale or Correct count; the last includes held items. Preview before/after quantities and preserve selling increments.

Example acceptance fixture: on shelf 12, held 3, available 9. Receive 6 previews 18 / 3 / 15. A counted total of 2 conflicts with the 3 held. An unknown opening count must be established before a restock/sale using the current backend rules.

The compact product editor can still offer price and count as its main routine fields, provided it displays the three stock facts and routes a changed count through the movement/version contract. Provide direct stock-task buttons so staff do not have to reinterpret a count field when receiving stock.

Field semantics:

| Input state | Intended write |
| --- | --- |
| Field untouched | No change, even if displayed blank/unknown. |
| Positive/allowed numeric value entered | Set that fact after validation and version checks. |
| Physical count entered as 0 | Explicit confirmed zero stock, subject to reservations. |
| Price entered as 0 | Require explicit Free; never treat an unknown price as free. |
| Staff deliberately chooses Mark unknown/Clear fact | Explicit operation supported by policy/backend; never an accidental empty input side effect. |
| Text invalid or required field cleared while editing | Local error, retain input, do not silently reinterpret as unknown. |

Bulk entry writes only changed fields on changed rows. Use existing fact preview/apply services and receipts where suitable. Missing unit blocks a touched row, not an unrelated unchanged product. A batch committing 50 rows at a time must show committed/remaining/conflicted counts and resume the same batch after uncertainty.

### Messages, settings and access

Inbox rows show latest speaker, useful preview, timestamp, unread/selected/help state and a permitted stable identity label. Retain attachment access, saved reply drafts, search and return position. A takeover is conversation-scoped; return-to-assistant is equally visible. Global pause overrides local resumption. Sending a manual reply still respects current channel eligibility/window rules.

Settings contain usage, integration details, test-recipient scope and global pause. Surface only actionable operational failures in the daily workspace; do not hide a sending outage inside Settings. Message examples remain labelled, inert and secondary.

Authentication is a state, not endless loading. Distinguish sign-in required/expired, forbidden shop, offline, server error and loaded-but-stale data. Restore the intended route after authentication; never display a fabricated logged-in shop or zero count.

## 2. Reuse the current implementation

Paths below are relative to `02-Build/shopbot-ai/`. Anchors identify inspected source, not a complete code audit.

| Area / source anchor | Existing foundation | Planned change |
| --- | --- | --- |
| `apps/dashboard/src/OwnerDashboard.tsx:51`, `:94`, `:102`, `:112` | URL views, navigation, unsaved-page warning, guarded manual sending and status UI. | Responsive shell, localized labels, four daily destinations, secondary Settings, explicit auth/recovery presentation and consistent navigation guard. |
| `apps/dashboard/src/owner-model.ts:6` | Existing route keys: overview, requests, conversations, catalog, connections, message-review. | Preserve keys/deep links while changing visible labels and arrangement. |
| `apps/dashboard/src/OwnerOrders.tsx:15`, `:38`, `:44` | Stage selection and approval/stock/advance/fulfillment actions. | Shared testable presentation selector, clearer filters/age, responsive worklist/sheet and complete exceptional states. |
| `apps/dashboard/src/OrderQuoteEditor.tsx:29`, `:39`, `:52`, `:64`, `:74` | Optional matching, dirty/version/conflict handling, save/send and notification reconciliation. | Preserve these contracts; adapt cards/table and guided focus; clarify save state and retain direct store-item/photo/suggestion behavior. |
| `apps/dashboard/src/OrderWorkflow.tsx:10` | Advance/refund/amendment details. | Contextual presentation and localized copy; keep truthful financial states. |
| `apps/dashboard/src/OwnerCatalog.tsx:20`, `:53` | 25-row paginated product API and existing editor/draft capabilities. | Simpler routine editor/list, labelled Add, attention filters and preserved creation/photo/aliases capabilities. |
| `apps/dashboard/src/OwnerStock.tsx:10`, `:14`, `:16` | Versioned stock writes, three totals, movement kinds and history. | Make task buttons visible and add result preview rather than replacing the stock service. |
| `apps/dashboard/src/OwnerQuickPrice.tsx:15`, `:16`; `OwnerBulkFacts.tsx:33` | Fact preview/apply, uncertainty recovery and resumable receipts. | Reuse for simpler single/bulk edits; remove duplicated ceremony only after retaining the validation/receipt contract. |
| `apps/dashboard/src/owner-ui.tsx:20`, `:35`, `:46`, `:52` | Semantic navigation, live notices, image variants/dimensions and modal foundation. | Shared focus return, labels, enlarged-photo behavior and consistent task notices. Preserve existing good accessibility. |
| `apps/dashboard/src/owner-polling.ts:2` | Visibility-aware, non-overlapping polling. | Continue background refresh without replacing typed input or issuing redundant reads. |
| `apps/server/src/http/owner.ts:116`, `:126`, `:131` | Snapshot capped at 100 conversations/orders, separate active/history aggregates. | Add bounded server list/search/pagination and necessary stage aggregates if complete queue/history views are promised. Never label loaded-page counts as global. |
| `apps/server/src/services/inventory.ts:71`, `:88` | Movement idempotency, inventory versioning, reserved-stock checks; catalog saves are counts too. | Reuse unchanged for stock semantics; add adapter validation only if needed. |
| `apps/server/src/http/owner-facts.ts:9`; `services/catalog-fact-imports.ts:60`, `:97` | Store-scoped export/preview/read/apply and field-level change records. | Add an inline-grid adapter to the existing fact contract instead of a second bulk-write implementation. |

Proposed small modules, if extraction improves clarity: an owner task/action presentation selector, owner locale resources, shell/navigation components and a stock-change preview helper. These are proposed file responsibilities; no such new files are claimed to exist. Avoid a framework migration or a new general state-management dependency for this redesign.

## 3. Eight work packages

### WP0 — Establish the baseline and lock the task contracts

**Dependencies:** none. **Scope:** source, design fixtures and acceptance preparation.

- Record current source, branch, runtime/report provenance separately and check for concurrent work. Preserve the earlier context files and original PDFs.
- Reproduce current order/stock/message behavior using isolated synthetic fixtures. Keep a complete order, an eight-line unresolved order, a non-catalog item and a 12/3/9 stock fixture.
- Confirm the action-precedence table against the existing service responses, including amendments and legacy stock. Define global/loaded/filtered count scopes.
- Capture current task time, clicks/backtracking, browser requests, image bytes and render responsiveness. Record the intended old computer and phone model/browser if available; otherwise leave hardware performance unverified.
- Reuse the current regression suite. Historical 837-pass evidence is a baseline record, not a fresh result.

**Exit:** shared fixtures and explicit contracts make later UI changes comparable; no new commercial fact is fabricated.

### WP1 — Build one responsive, localized order workspace slice

**Dependencies:** WP0. **Scope:** shared shell plus Orders, rather than restyling every page first.

- Keep the four daily destinations, phone bottom navigation on list screens and compact desktop navigation. Detail tasks prioritize Back, context and task action. Settings remains reachable but secondary.
- Preserve existing URL route values, browser Back, selected order, filters, search and scroll/focus restoration.
- Build the fixed-window shell with `min-height:0` and explicit task scroll regions. Use flexible sizing; do not copy PDF canvas dimensions or shrink text to force content onto a short screen.
- Start owner English/Tamil resources for the shell and order slice. Owner interface language must not change a customer's reply language. Keep SKU/model names intact and set document/region language appropriately.
- Add safe-area spacing and verify soft-keyboard behavior; do not assume dynamic viewport units solve every browser case.

**Files:** OwnerDashboard, owner-model/UI, owner-workspace CSS, Orders CSS, proposed owner locale resources.

**Exit:** a real order can be opened and navigated on phone/desktop, with readable controls and preserved routes at the first target sizes.

### WP2 — Complete adaptive quoting without losing existing guarantees

**Dependencies:** WP1. **Scope:** quote editor and guided focus.

- Render the same fields as cards/table, including original request and expandable photos. Preserve reference-photo labels and orange editable suggestions.
- Add direct store-item editing alongside optional matching; preserve the photo when detaching a suggestion. No inventory-creation prerequisite.
- Validate required facts inline, focus the first issue and allow work on other rows. Do not demand repeated affirmation of already established facts.
- Keep integer-paise server prices and valid unit/count precision. Distinguish unknown, estimated, real price and explicit Free.
- Preserve the current save-draft/send contract, version binding and one logical send. Any autosave must use the existing durable draft API, be sequenced with Send, and report saved only after acknowledgement. Keep manual Save/retry until that behavior is verified.
- Cover a single coherent eight-line case through item correction, pricing and review; the PDFs' two-item sample alone cannot establish continuity.

**Files:** OrderQuoteEditor, owner-editor-save helpers, order-quote-drafts/order-quotes integration, existing quote tests.

**Exit:** a complete order can send directly; an unresolved/non-catalog order can finish with only necessary edits; reload/conflicts preserve recoverable input.

### WP3 — Complete approval, fulfillment, counts and delivery recovery

**Dependencies:** WP2. **Scope:** all order stages, plus read-side completeness.

- Present waiting approval, expired/rejected/revised quotes, customer changes, required advances, stock shortage, acceptance, ready, collected and cancellation paths.
- Preserve separate payment, acceptance and fulfillment state. Add a visible packing list after approval/acceptance, not another editable quote by default.
- Show queued/delivered/failed/uncertain notifications accurately and route recovery through existing reconciliation. Do not automatically resend historical messages.
- Implement bounded server search/pagination and global stage counts where the new queue needs them. An interim loaded-count label is acceptable only when explicitly scoped; it is not a substitute for retrieving older orders in the final complete view.
- Keep primary Active/History grouping if staff find it familiar; provide compact filters for the actual next jobs. Sort actionable work predictably and retain full date/age for older orders.

**Files:** OwnerOrders, OrderWorkflow, OwnerOverview, owner read API/query services; preserve existing mutation services.

**Exit:** a quote can reach collection through the normal path; exceptional states have a next action; search finds records beyond the first 100 without leaking another shop.

### WP4 — Simplify Products and implement safe quick/bulk facts

**Dependencies:** WP1; WP0 stock/write contracts. **Scope:** product list, routine edit and stock tasks.

- Keep bounded product pages, thumbnail variants, search/attention filters and a visible labelled Add product. Preserve photo/name/aliases onboarding, draft/publication and original images.
- Separate routine edits from rare fields. Allow a price-only update without forcing an unknown stock count; identify price per selling unit and explicit Free.
- Expose On shelf/Held/Available and the three stock tasks with before/after preview and reason. Preserve unknown opening-count handling and count-below-reserved rejection with a useful next step.
- Build a bulk table for a bounded visible page with a dirty-row store keyed by stable SKU. Show pending edits when filtering/paging; provide Save/Discard/Keep editing, not silent loss.
- Generate changed-field payloads through the existing fact preview/apply contract. Preserve expected product/inventory versions, chunk receipts and operation identity during retries.
- Show saved/failed/conflicted/remaining outcomes by row and allow a safe fresh preview after changes. Never overwrite reservation state or unrelated catalog fields.

**Exit:** the 12/3/9 fixture behaves correctly; price-only updates preserve stock; an unrelated unresolved row does not block valid edits; partial batches resume without duplicates.

### WP5 — Complete inbox, takeover, settings and authentication

**Dependencies:** WP1, WP3 read-side contracts. **Scope:** remaining daily/secondary views.

- Preserve inbox filter/search position and reply drafts. Use stable permitted customer labels and distinguish unread, selected, needs-help and last speaker.
- Display original photo/voice/transcript content and message delivery states. Keep order links specific when a customer has more than one order.
- Cover assistant handling, owner takeover pending/success/failure, owner reply, return-to-assistant and global-pause precedence. Preserve current revision and eligibility guards.
- Distinguish initial load, refresh failure with loaded data, offline, expired sign-in and forbidden access. Preserve draft text across reauthentication according to existing storage/privacy policy; do not add indefinite browser storage without a retention decision.
- Finish owner localization, connection detail and secondary usage/message examples. Changing owner language preserves active drafts and does not translate customer-authored transcripts.

**Exit:** staff can take over, send once and return control; stale/closed-window/offline cases are truthful and recoverable; wrong-shop access remains denied.

### WP6 — Verify accessibility, scale and old-device performance

**Dependencies:** relevant slices from WP2–WP5. **Scope:** functional and measured verification.

- Run the [acceptance matrix](ACCEPTANCE-TESTS.md), keyboard-only navigation, screen-reader smoke checks, narrow reflow and contrast checks against actual CSS.
- Verify footer/nav behavior with a real phone keyboard and at enlarged text/zoom. Keep content reachable if a short visual viewport needs more internal scrolling or reduced secondary chrome.
- Use existing 25-row catalog pagination. Paginate messages/order reads and defer offscreen images. Avoid loading the entire catalog or history into the browser to satisfy visual mockups.
- Measure the intended older computer and weak network against WP0; record task timings, requests, transferred bytes, polling overlap and long interactions. Establish performance budgets from that evidence rather than inventing a speedup claim.
- Run required build/typecheck, focused PostgreSQL integration tests, catalog checks and full regressions once the combined implementation is ready. Do not repeatedly rerun broad suites without a change/failure that justifies it.

**Exit:** recorded behavior and measurements, with hardware/browser limits stated. Static screenshots alone cannot satisfy this package.

### WP7 — Staff acceptance and controlled release

**Dependencies:** WP6 and user acceptance of implemented behavior. **Scope:** reviewable candidate and release handoff.

- Have intended Tamil/Tanglish shop staff complete the same quote, stock and pickup tasks against the baseline and candidate. Record wrong turns, help, edits, completion and missing facts; separate speech errors from interface errors.
- Fix silent wrong product/unit/count, lost draft, unintended stock change, duplicate mutation and false payment/delivery claims before activation.
- Prepare focused commits/PRs and repository-required checks. Keep the selected release and any UI flag tied to the actual candidate; a UI rollback does not roll back database activity.
- Prepare fresh backup/restore and code rollback evidence before any later authorized activation. This planning request authorizes no deployment or customer test messages.
- Keep real-device/channel acceptance distinct from synthetic fixtures and staff usability. Preserve any existing production-pilot gate.

**Exit:** reviewable implementation, recorded staff/device outcomes and explicit remaining issues. Only a later authorized activation changes the deployed app.

## 4. Suggested delivery slices

| Slice | Outcome | Packages |
| --- | --- | --- |
| 1 | Open, correct and quote one order on phone and desktop with preserved drafts. | WP0–WP2 |
| 2 | Approval-to-collection plus exceptions and complete queue/search semantics. | WP3 |
| 3 | Safe routine product updates, stock tasks and resumable bulk work. | WP4 |
| 4 | Inbox/control/auth/settings consistency. | WP5 |
| 5 | Evidence, staff acceptance and release candidate. | WP6–WP7 |

Do not delay the first reviewable order slice until every secondary screen is polished. Each slice needs its own relevant checks and can be reviewed without activating it on the live server. No duration estimate is asserted before measuring the existing behavior and integration work.

## 5. Scope boundaries

This is primarily UI/workflow integration. Preserve customer AI prompts/models, WhatsApp recipient rules, provider budgets, payment policy, source media and existing merchant facts unless a separately justified change is needed. Expected read-side additions are bounded lists/search and truthful stage aggregates. No new commerce-state migration is assumed; justify any schema change separately with compatibility and restore evidence.

Do not bake source examples such as 8 orders, 336 products, ₹10 advance or the fictional ₹300 bill into UI logic. Fetch actual shop facts and applicable policies. The responsive UI should consume the same authorized services as the current application and MCP tools.
