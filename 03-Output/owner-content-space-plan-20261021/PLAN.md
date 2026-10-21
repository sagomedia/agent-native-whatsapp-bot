# ShopBot owner interface: content-first revision plan

21 October 2026. Planning baseline: `d1853a0`. This is a proposed implementation plan, not a UI change or a deployment. It follows the owner's screenshot of Orders and explicit request for a detailed better version.

## 1. Outcome

Give the working content most of the screen: orders to review, the customer's messages, product facts and editable fields. Reduce repeated framing and controls without removing the information needed to make a correct shop decision.

Success means staff see more work immediately, can understand the current state, and can finish the same tasks with the same or fewer actions. A lighter border color alone will not achieve this. The main work is reorganizing headers, toolbars, scroll ownership and action placement.

## 2. Evidence and root causes

The supplied screenshot shows separate bands for the shop header, page heading/status, stage selection, assistance notice, search label/input, repeated list title, pagination and bottom navigation. Orders begin halfway down the image. Source review confirms several fixed-height/flex layers compete for the remaining height.

Read-only measurements against the synthetic production-asset preview give these baselines. These are CSS viewport measurements, not the pixel dimensions of the supplied screenshot. They are fixture-specific, before implementation, and do not measure human task performance.

| Working region | At 320×640 | At 390×844 |
| --- | ---: | ---: |
| Orders list viewport | 118px | 289px |
| Selected order item viewport | 223px | 391px |
| Selected conversation message viewport | 71px | 243px |

The 320px Orders worklist spends 60px on the app bar, 47px on the page header, 52px on stage selection, 44px on assistance, 99px on search, 34px on the repeated queue heading and 59px on pagination. Gaps, preview labeling and navigation consume more. The content gets the remainder.

The order detail already has more usable space than the worklist; its 153px footer remains expensive. Messages are the most severe case: metadata and supplementary controls can leave almost no transcript visible. Different screens therefore need different structures, rather than a universal smaller-padding override.

Technical contributors:

- `owner-workspace.css` locks the document/root and sets a fixed-height owner shell; later files override individual scroll behavior.
- `owner-usability.css` fixes the app bar/navigation and hides overflow on Orders/Messages while stacking nonshrinking header and toolbar elements.
- `orders.css` gives the queue its own search, heading, scrolling list and permanent pagination footer, inside another workspace.
- Product and CSV screens combine page headers, tool rows, record headers, summaries and sticky save controls. Each is individually reasonable; together they consume the short viewport.
- Overlapping rules across `owner.css`, `owner-workspace.css`, `owner-usability.css`, `orders.css` and `owner-inventory.css` make local fixes affect other pages or break at a different width.

See [measured baseline](BASELINE.json) and `evidence/` for captured screens. The earlier [process review](../owner-inner-workflows-20261021/README.md) remains the functionality inventory to preserve.

## 3. Design direction and rules

### Keep the shop's identity; change the hierarchy

Use the existing palette: white `#ffffff`, pale background `#f2f6f3`, text `#20382e`, muted `#52675d`, teal action `#19685f`, warning `#8b520d`. Keep the existing Arial/bundled Tamil fonts. This revision does not need a new theme, icon library or component framework.

Use alignment, type weight, whitespace and subtle row separators to organize work. Reserve stronger outlines for editable inputs, focused elements, meaningful boundaries and exceptions. Avoid outlining the workspace, toolbar, search section and each row as four nested boxes.

| Element | Treatment |
| --- | --- |
| Main work surface | One continuous surface; no decorative perimeter card on phone |
| Repeated list rows | Thin horizontal separator; no individual rounded card border |
| Selected row | Pale selected fill and a restrained marker; selection also exposed semantically |
| Normal action | Text/icon button where clear; visible hover/focus and sufficient hit area |
| Main action | Solid teal; usually one primary action for the current task |
| Status | Plain text or small semantic badge; no full banner for routine normal state |
| Failure/blocking fact | Persistent actionable message; keep next step and retry visible |
| Inputs | Clear labels and borders; no placeholder-only form fields |

Desktop editable controls can stay 36–40px high where practical; phone primary/touch controls should have at least 44px hit areas. Keep phone input text at 16px. Do not meet density targets by shrinking Tamil labels, touch targets or content text. A 4/8/12/16/24px spacing scale distinguishes controls, field groups and major sections.

### One title, one toolbar, one primary scrolling region

Each screen should have one visible title for its current task. A visible stage selector already naming Needs review does not need a second Needs review header below search. Counts belong beside the relevant label.

On phones, list pages use one main vertical content scroller containing controls and rows; controls may scroll away. Keep only the compact app header and navigation persistently outside it. A record/detail screen may instead use a stationary compact identity/action area with one central scroller. Do not put a small independent list scroller inside a scrolling page.

Desktop split views may have independent list/detail scrollers because they are side-by-side work areas. They must each fill the available height and remain keyboard reachable. Horizontal table scrolling is a separate permitted axis.

## 4. Shared shell

### Phone and narrow tablet

1. Use one compact top bar, approximately 56px before safe-area/preview labeling. On a worklist show the current page title, such as Orders; retain shop identity in an accessible shop/tools menu. On a selected record show Back and its short identity.
2. Remove the second page-heading/status band from these screens. Preserve a single semantic `h1`, screen title and accessible navigation labels.
3. Move language, shop name, routine last-updated time, Settings, Message review and optional Quick help into an accessible toolbar menu. Show the current language in that menu; changing it takes at most one additional action. Keep a direct route to urgent connection/permission failures.
4. Use a labeled menu trigger with a 44px hit area. Do not make secondary functions hover-only. Keep language selection native and labeled after opening the menu.
5. Keep the four real bottom destinations on phone worklists. Target 56–64px plus the actual safe-area inset. Preserve labels and selected state.
6. In focused order/product/conversation detail, replace the persistent global bottom navigation with the current task's compact action/composer bar. Back returns to the worklist; the tools menu still reaches global navigation. This is a deliberate navigation tradeoff to verify with staff.
7. Remove the routine privacy/time footer from the work viewport; retain that information in the tools/about area. Keep the synthetic-preview marker visible in the local harness so test mode remains unmistakable.

Do not add scroll-direction hide/show animation in the first pass. A smaller stable header plus scrollable secondary controls provides the space gain with less jumping. A collapsing header can be evaluated later if the stable version misses targets.

### Desktop

Retain task-based side navigation. Use a single compact page heading/toolbar. Move routine sync status into that toolbar. Remove redundant page subtitles where the screen already explains itself. Keep informative descriptions on unfamiliar/empty states or in optional help. Avoid mobile-derived nested card wrappers around split views.

### Warnings and asynchronous states

Routine Preview/updated state can move into compact status/menu content. Offline, sign-in expiry, failed saves, unknown outcomes, short stock, refund due and conflicting charges cannot disappear for density. Present a short message beside the affected work with a clear recovery action; detailed explanation can expand. Expandable content must participate in scrolling rather than shrink the main work area indefinitely.

## 5. Orders worklist: first implementation slice

### Proposed phone structure

```text
Orders                                Tools
Needs review · 4  v               Search
1 customer needs help                    >
──────────────────────────────────────────
#7BAAA6                       Stock check
Customer 3e2d7ea3          2 items · 8:07
PVC pipe, Measuring tape
──────────────────────────────────────────
#8FBA64                        Quote needed
Customer 6d845ff0          3 items · 8:02
Pipe, socket, valve
──────────────────────────────────────────
More actual orders…

[Paging only when more than one page exists]
Today       Orders       Messages    Products
```

The stage controls, assistance indicator and results all belong to the same page scroller. This is a structural sketch, not a fixed-height contract for translated text.

Detailed changes:

- Combine stage name and count in a compact labeled selector/toolbar. Desktop keeps stage links as navigation; avoid squeezing all stages into phone tabs.
- Make Search a 44px accessible toggle that expands an inline labeled search field. Search automatically opens when `orderSearch` is present; query and Clear remain visible until cleared. Closing search must not conceal an active filter.
- Replace the large assistance box with a compact actionable count. Activate it to open the existing help queue in flowing content or a labeled sheet; acknowledge/reply stays available. Do not label routine help as a system failure.
- Remove the visible duplicate queue title/count while retaining a proper accessible results heading.
- Remove the outer list card and padding around its inner list. Use the row itself as the navigation link; preserve order ID, state, customer, item count, time and two-line preview. Keep unknown totals truthful; do not add a misleading estimate just to fill space.
- Target roughly 100–116px rows for the standard English fixture; Tamil/long names may grow naturally. Show essential state and identity in full. Truncate only previews with complete text available inside the order.
- Render pagination only when the response has a previous or next page. For a single page, show a compact count once. Keep real bounded server pagination; no unimplemented infinite-scroll behavior.
- Search/stage/page state and selected-order links retain their current URL behavior. Returning from a detail restores the list's position and filters. Opening a clean task shortcut still deliberately clears unrelated state.

## 6. Orders detail, quote and fulfillment

- Replace the outer Orders heading, separate Back row and repeated selected-order header with one compact identity area: Back, short order number, customer and current stage.
- On phone, remove the global bottom nav while the record's action bar is present. Keep a visible Back link and tools/navigation access.
- Keep the current one-sheet quote. Use one central scrollable area for facts, item rows, match suggestions, original request, payment, changes and pickup information.
- Place brief current-step guidance in the content; put a concise blocker count beside the main action. Do not repeat the same instruction in a banner, progress row and footer.
- Keep payment, approval and reservation facts directly visible near the top of content as compact labeled values. Expand transaction history and original source details on demand. Unknown payment and unknown stock remain explicit.
- Make the footer one compact total/action row where width permits, and at most two rows on short phones. Normally show the total, Save draft and the current primary action. Notification choice remains clearly reachable in order details; if notification is off, that fact must remain visible near a send action.
- If errors need more than the reserved footer space, place the detailed alert in the central scroller, focus it, and keep a short persistent footer indicator. Do not clip the message or replace it with a generic toast.
- Retain large inspectable product photos. Reduce repeated margins around image/text, not the source image's useful inspection size. Full photo remains one explicit action.
- Catalog matching opens beside the relevant row in flowing content; on narrow phones it may use a full-height dialog only if inline matching makes the active row unreachable. Choose one approach based on the measured spike, not both.
- Keep existing advance/refund checks, proposal review, cancellation confirmation, customer approval, exact retry tokens and reservation/collection semantics.

## 7. Messages worklist and conversation

### Inbox

Combine page identity and help/all count. Put search and filter controls in a compact toolbar. Remove the enclosing card border and duplicate selected-customer heading. Rows retain customer, recent message, time, help state and ownership. Use a single page scroller on phone.

### Conversation

Use a compact Back/customer header with ownership/reply eligibility. Make the transcript the dominant central area. Place the composer or honest unavailable-reply action at the bottom. Hide global bottom navigation during this focused view while preserving Back/tools navigation.

Move interpretation evidence, customer draft/list, detailed ownership explanation and all-customer-orders navigation into a labeled Conversation details section/sheet. Keep a compact Back to order link when the conversation was opened from an order. Ownership and closed-window/sending-disabled states must remain understandable before takeover.

Earlier/Newer/Latest controls should occupy compact rows within the transcript, not permanent external bands. When viewing earlier history, preserve the explicit return-to-latest requirement before composing. Maintain draft text and exact retry identity across navigation and failed replies. New-message notification must not force scrolling when staff inspect earlier content.

Preserve original customer images, audio, delivery status and actual transcript timestamps. Do not compress message text or attachments into tiny previews merely to achieve a height number.

## 8. Products: inventory and record

### Inventory list and inline price/count updates

- One Products title/toolbar with New product and Search. Show applied filters compactly; advanced filter controls expand into flowing content.
- Place inline facts, CSV and unpublished drafts in a clearly named secondary tools menu/row. Routine price and stock actions remain directly on each product, preserving the current measured two-click price path from a visible row.
- Remove perimeter cards around toolbar/table. Keep meaningful table headers, horizontal row separators, selected/edited-state cues and aligned numeric columns.
- Desktop retains name/code/price/on-hand/held/available/visibility/actions. Phone uses labeled compact records; at a fitting intermediate width use a reduced table only if actual labels remain readable. Do not drop held/available stock or units to make columns fit.
- Integrate result counts into the toolbar or terminal pager. Omit disabled single-page pagination bands.
- For inline edits, keep the change count, review/save and recovery state together. Off-page edits remain reachable. Do not move partial-save receipts into an inaccessible menu while errors exist.

### Product record and its five sections

- Replace the separate Products page title, global tools strip and record header with a contextual product header in focused phone mode.
- Keep Back to order for repair, otherwise Back to inventory, with SKU and More actions in allocated columns.
- Keep price, on-hand, held and available as a compact fact strip without four individual boxes. Full definitions remain accessible where needed.
- Keep the five section names/selector, and preserve `productSection` on refresh. The active section's form is the main scroller; avoid a second header inside a header for the same section.
- On phone show a compact save bar with state and actual primary/secondary actions. Avoid repeating a New/Draft/Published panel above and below the form. Stock tasks keep their own result/action beside the quantity; metadata Publish should not look like the way to save a stock movement.
- Photos, selling basis, source comparisons, Tamil aliases and diagnostics remain available in the appropriate sections. Required fields and save errors cannot be hidden just to hit content targets.

## 9. CSV, drafts, quick dialogs and evidence

| Inner screen | Proposed layout change | Behavior that must remain |
| --- | --- | --- |
| CSV start | Compact title, export/upload, then expandable rules; no large introductory card | Same checked-facts columns, blank-vs-zero semantics, local preview before apply |
| CSV review | Small status/count strip; rows are primary content; compact apply bar only while actionable | All pages, error rows, expiry, exact chunk recovery, saved batch URL, receipt |
| Completed CSV | Completion heading and saved counts; receipt/new-file actions in content | No unnecessary permanent Apply footer once complete |
| Unpublished drafts | Single search/filter toolbar and flowing draft rows | Exact selected-record retry, source conflict facts, cancellation of stale reads |
| Import progress | One expandable list/detail section; no nested perimeter cards | Honest staged/failed/kept row states and existing operator correction/reimport path |
| Quick price | Compact product identity, price and unit, save/cancel | Explicit free-item exception, validation, Enter, conflict/uncertain recovery |
| Quick stock | One totals strip, task controls, quantity/result/action; history in content | Physical count includes held units; unknown is distinct from zero; exact retry |
| Photo/source comparison | Large useful images with captions and light separation | Full originals, exact vs reference distinction and provenance |
| Publication | Actual-value summary and one explicit confirmation | No new checklist, no write before confirmation, server validation |
| Cancellation/refund | Clear consequence, relevant facts, labeled actions | Explicit cancellation; actual bank/refund reference; no false payment claim |

Dialogs use one central scroll region and reachable buttons. Full-height narrow-screen dialogs are preferable to a tiny nested scrollbox when information is long. Native dialog focus/escape behavior remains. Never let shortening the footer make irreversible actions ambiguous.

## 10. Today, Settings and Message review

### Today

Show actual work early: needs-review orders, ready pickups and customers asking for help. Replace large count/action tiles with compact counts and direct destinations. Keep no-work states useful. Preview/connection facts are one compact notice rather than repeated badges. Pending sends and unknown outcomes remain actionable. Detailed diagnostics stay optional; failed diagnostic reads still have visible retry.

### Settings

Use a plain, aligned settings layout with clear section headings and subtle section rules. Retain section navigation without a permanent oversized band on phone. Connection state, pause/resume, budget and spending reservations remain discoverable. Exact cost ledgers, analytics month, conflicting charges and audit activity stay available; do not imply a complete invoice or allowance from incomplete data.

### Message review

One title and a compact language/stage toolbar, followed by actual message examples. Use spacing between examples rather than multiple nested cards around a phone mockup. Keep the accessible full text, failure retry, no-match reset and disabled sample commerce controls. A preview never sends a customer message.

## 11. Responsive and scrolling contract

| Screen mode | Vertical scrolling owner | Stationary elements |
| --- | --- | --- |
| Phone worklist / Today / Settings / previews | Main page content, including ordinary toolbar/assistance | Compact app header and bottom navigation |
| Phone order detail | Order content | Compact identity and quote/action footer |
| Phone conversation | Transcript | Compact customer identity and composer/eligibility action |
| Phone product record | Active form/stock section | Compact identity/section control only if targets allow; compact save actions |
| CSV review | Preview content | Compact header and actionable apply controls; avoid also reserving duplicate global footers |
| Desktop split Orders / Messages | Independent side-by-side queue and record areas | Small shared toolbar plus each area's necessary identity/actions |
| Desktop inventory/settings | Main area; horizontal table region where needed | Side navigation and necessary local table header |

Breakpoints describe available space, not a device model. Use narrow single-pane layouts when a split cannot keep useful list/detail widths. Test the existing 800px boundary and nearby widths to prevent a toolbar suddenly stacking into six bands. Do not use a screen-height rule as a substitute for removing redundant structure.

Use `min-height:0`, `min-width:0`, explicit grid tracks and `100dvh` deliberately. Keep keyboard focus above fixed bars using scroll padding/margins. On keyboard-open or highly zoomed screens, allow the layout to flow/scroll rather than preserving an unusable fixed-height center. Apply safe-area padding once, not in both global nav and record footer.

## 12. Measurable acceptance criteria

These are proposed targets for implementation. They are not claimed improvements yet. Baseline measurements include the synthetic preview strip; compare like-for-like fixtures, locale, viewport and warning state.

| Region / behavior | Normal 320×640 target | Normal 390×844 target |
| --- | --- | --- |
| Orders list: usable vertical content span above bottom navigation | At least 340px, versus 118px baseline | At least 500px, versus 289px baseline |
| Orders list: first row begins | At or above y=220 | At or above y=220 |
| Selected order central scroller | At least 300px, versus 223px | At least 480px, versus 391px |
| Selected conversation transcript | At least 300px, versus 71px | At least 480px, versus 243px |
| Product active form visible beneath identity/sections and above actions | At least 220px in General fixture | At least 360px in General fixture |
| Standard orders visible without scrolling | At least 3 complete standard English rows | At least 4 complete standard English rows |
| Phone touch controls | 44px hit area, readable labels | Same |

The Orders list span may become a main-page region instead of an element with a fixed inner height. Measure the visible intersection of actual row content with the viewport between the compact controls and navigation; do not keep the old scrollbox solely to pass the test.

At 320px Tamil, preserve labels and prefer a natural additional line over squeezing text. Target at least 300px usable worklist span and two complete representative long-Tamil rows, then refine against real copy. Other Tamil screens should meet the same central-scroller targets unless a documented meaningful label wrap requires a small exception. Never hide transaction warnings or focused fields to pass a geometry assertion.

Additional gates:

- One visible current-task title; no repeated stage heading/count in normal worklist state.
- No permanent pagination band for a single page; previous/next remain when meaningful.
- One primary vertical scroll area per phone screen; permitted dialog/table axes documented.
- No horizontal page overflow, inner button-text clipping, overlapping controls or fixed-bar focus occlusion.
- Search and filters in the URL remain visibly apparent when active; refresh/back/forward preserve the intended work.
- Product quick price remains two pointer actions excluding typing; quick stock gains no additional required review screen. Direct return to the originating order remains one action after known save.
- Every existing source/stock/payment/draft/recovery control has a mapped destination. No hidden blockers or unsupported actions.
- Expanded help, long validation errors, offline/auth notices, 200% zoom and a simulated keyboard never create an unreachable action or zero-height content area.
- Synthetic geometry is not proof of usability: observe staff completing quote, pickup, count/price and reply tasks without coaching; record wrong turns and help requests.

## 13. Implementation sequence and checkpoints

### Phase A — baseline and layout spike

Preserve screenshots, measurements and a map of every scroll container. Add baseline fixtures with help present, multiple pages, long Tamil rows and loaded/failed states. Prototype only Orders worklist and selected conversation at 320×640/390×844. Resolve the shell/scroll approach before spreading CSS across all pages. Compare with the screenshot and numeric targets.

Deliverable: before/after working-region measurements, reviewable screenshots and a small structural diff. If targets require text/control shrinking, revise the structure instead.

### Phase B — shared shell and Orders list

Implement compact header/tools, mode-specific navigation and routine footer removal. Merge Orders stage/count/search toolbar; change list scrolling, assistance and conditional pagination. Verify all stages, checkout mode, search, help, failed reads and list-return position. This is the first complete user-visible checkpoint.

### Phase C — focused Orders and Messages

Apply selected-record shell, compact action/composer layout and supplementary details. Preserve notification choice, payment/stock facts, lost-response recovery, earlier messages and manual drafts. Validate short-screen scrolling with keyboard/focus and a long error before moving on.

### Phase D — Products and all catalog inner screens

Consolidate toolbar and record identity; reduce perimeter boxes; reorganize save/stock actions and CSV/draft layouts. Retain the five sections, aliases/photos/selling details, bulk partial-save handling and source evidence. Verify hidden cached Products styles do not affect other pages after SPA navigation.

### Phase E — Today, Settings and Message review

Apply the same hierarchy to work counts, real order previews, settings rows and message examples. Preserve contextual failures and detailed financial/source information. Use this phase to remove obsolete CSS rules rather than append another override layer.

### Phase F — regression, teaching and release handoff

Run the geometry/state matrix and existing meaningful workflows; fix layout failures, then repeat only affected checks. Capture final production assets and publish commit/PR/check links. Perform intended staff/native-Tamil/physical-device checks. VPS deployment is a separately authorized release step with existing deployment/rollback verification; it is not part of this planning request.

Keep each phase focused and reviewable. Start implementation from the then-current repository state: if PR #57 remains the same unfinished change, preserve it; if it has merged, use updated main and a new branch. Do not accumulate new work on a merged PR or overwrite another branch's edits.

## 14. Code changes and verification ownership

| File / area | Planned responsibility |
| --- | --- |
| `OwnerDashboard.tsx` | Shared title/tools/status, selected-view mode, conversation structure and truthful status placement |
| `owner-workspace.css` | Root/shell sizing and deliberate scroll ownership |
| `owner-usability.css` | Shared compact spacing, mobile/desktop shell, borders and responsive rules |
| `OwnerOrders.tsx` / `orders.css` | Worklist toolbar, help placement, list flow, conditional paging, detail framing |
| `OrderQuoteEditor.tsx` / `OrderWorkflow.tsx` | Compact footer and in-content guidance/errors; retain commerce flows |
| `OwnerCatalog.tsx` / `owner-inventory.css` / `OwnerProductTabs.tsx` | Table/record framing, fact/section allocation and local action layout |
| `OwnerBulkFacts.tsx` / `OwnerInlineFacts.tsx` | Compact review/apply/receipt placement and pending-state visibility |
| `OwnerStock.tsx` / `OwnerQuickPrice.tsx` / `OwnerProposals.tsx` | Compact inner forms and source queues with exact recovery |
| `OwnerOverview.tsx` / `OwnerMessageGallery.tsx` / `OwnerObservations.tsx` | Actual work/examples ahead of supplemental framing; details remain reachable |
| `owner-locale.tsx` | Real translated labels for new navigation/toolbar terms; no English-only density assumption |
| Browser checks | Content-space budget, scroll ownership, filter visibility, keyboard/focus, clipping and all retained workflows |

Prefer explicit shell/worklist/record mode classes or data attributes over DOM-shape-dependent `:has()` overrides. Consolidate selectors as modes change; remove superseded rules and unnecessary `!important` conflicts. Use browser layout/CSS for sizing; avoid per-render DOM measurement or scroll listeners solely to set heights.

No backend changes or new dependencies are expected for this layout work. If a genuine API gap appears, separate it from the visual change and document it before extending scope. Do not introduce warehouse/supplier features or silently change fulfillment/payment behavior.

### Verification matrix

Run representative sizes: 320×640, 360×640, 390×844, 768×1024, 800/801 boundary, 1024×600 and 1440×1000. Cover English/Tamil and text/zoom stress. Use long identifiers/names and a large but paged dataset.

Exercise empty/one-page/multi-page lists, active search, failed/delayed reads, assistance expanded, current and historical order states, paid/unpaid/unknown stock, customer changes, expired quote, refund pending, offline/auth expiry, unsaved work and uncertain writes. Test pointer, keyboard, Back/Forward, refresh, focus restoration and the virtual-keyboard-sized viewport.

Existing current checks to retain:

- `check-dashboard-tasks.mjs`: daily jobs and exception/recovery behavior.
- `check-dashboard-usability.mjs`: quote workbench through collection; do not substitute the obsolete label-based `check-orders-workbench.mjs`.
- `check-dashboard-completeness.mjs`: contextual information and failed/empty states.
- `check-owner-inner-workflows.mjs`: order returns, exact retries, saved section/CSV state, clipping/overlap.
- `check-inventory-workspace.mjs`: inventory facts, publication and 60 section/language/viewport combinations.
- `check-owner-design.mjs`: six pages, CSV and order states; update structural assertions deliberately without weakening functional expectations.
- `check-owner-local-api.mjs`: actual isolated services; reseed after mutation checks.
- Production build/typecheck, UTF-8 PostgreSQL integration and catalog cleanup checks, followed by hosted checks for the final commit.

Add a focused content-space check with meaningful visible-region and scroll assertions. Do not treat total document width or a screenshot alone as proof: the previous pass had zero document overflow while labels still clipped and content was too small.

## 15. Tradeoffs and limits

- Search behind a toggle and language/tools behind a menu add one action for those utilities, while reducing clutter for every list scan. Active search must expand automatically. Keep direct price/stock/approval actions visible.
- Removing global bottom navigation in focused records gives more content space but may affect discoverability. Keep obvious Back/tools access and validate the tradeoff with staff before release.
- A single phone page scroller lets filters move out of view. Preserve their state and route; returning to the list restores the prior position. Avoid blanket sticky toolbars recreating the original space loss.
- Longer messages, Tamil labels, actual errors and accessibility zoom need more room. Density targets describe normal fixtures, not permission to hide important information in difficult cases.
- Browser automation proves bounded geometry and specified workflows, not that a new employee learns the tool in one teaching session. Measure the staff exercise separately.
- This plan does not merge, deploy, send messages, invoke live AI or move money. It is a concrete basis for the next implementation pass.

## 16. Reference patterns

The recommendations above are ShopBot-specific design decisions, informed by public documentation rather than copied vendor screens.

- [Carbon data table usage, version 10](https://v10.carbondesignsystem.com/components/data-table/usage/): co-locate search/filter/actions in a toolbar and progressively disclose row details. This is an explicitly versioned reference, not a claim about Carbon's newest release.
- [Material Components app-bar documentation](https://github.com/material-components/material-components-android/blob/master/docs/components/TopAppBar.md): compact and collapsing app-bar variants. For ShopBot, begin with a stable compact bar; animation is optional later.
- [Zoho Inventory item details](https://www.zoho.com/us/inventory/help/items/item-details.html) and [Odoo view architecture](https://www.odoo.com/documentation/19.0/de/developer/reference/user_interface/view_architectures.html): earlier inventory research supports grouped facts and contextual record sections, which this plan preserves. See the [existing research](../inventory-workspace-20261021/DESIGN.md).

The key change is giving content a defined space budget and a coherent scrolling model. Borders become quieter as a consequence of fewer competing containers.
