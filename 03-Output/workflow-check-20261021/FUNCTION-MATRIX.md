# Function-by-function verification

21 October 2026. “Pass” here means the named automated check passed in an isolated store with mocked external services or a synthetic local owner API. It does not mean a real customer, bank, phone or novice staff member has verified that function.

The complete UTF-8 PostgreSQL suite passes **842/842, with zero skipped tests**. Browser evidence and the actual local API result are recorded separately in `VERIFICATION.json`. Files below are under `02-Build/shopbot-ai/`.

| Function | Functional evidence | Result / limits |
|---|---|---|
| Today shortcuts, active/help/ready totals | `check-dashboard-tasks`, `owner-usability`, `owner-facts` | Pass; loaded and global totals distinguished. |
| Order stage, search and pagination | `owner-usability`: 130 orders/conversations, literal wildcard search, off-page selected metadata | Pass; older order beyond the first 100 is found. |
| Quote all original lines, duplicate references, direct store item | `check-dashboard-usability`, `owner-quote-workbench` | Pass; no mandatory catalog match or name-based auto-merge. |
| Indicative prices and large/original photo | Order browser, `owner-quote-experience`, `owner-catalog` | Pass; suggestions remain distinguishable and original-image inspection stays available. |
| Missing/invalid quantity, unit, price and explicit Free | New `quoteGuidance` tests and order browser | Pass; Resolve focuses the actual problem, including 101 quantity and explicit free confirmation. |
| Sealed pack versus measured/loose sale | New guidance tests, order browser, `selling-basis`/quantity/catalog regression families | Pass; the basis is checked before send and remains editable after choosing it. |
| Durable quote draft, navigation, reload, revision conflict | `owner-quote-workbench`, order browser, real local API | Pass; saved values recover; stale writes are rejected. |
| Quote send acknowledgement loss / current quote recovery | Order browser loses the committed quote response; `owner-quote-workbench` idempotency/version guards | Pass; the authoritative offered quote recovers the same attempt. Does not claim WhatsApp delivery. |
| Offered/expired quote, customer approval and notification retry | `owner-quote-workbench`, customer payment/channel suite | Pass; approval and notification are separate. |
| Acceptance, stock hold, packing, ready, collection | Order browser, real local API, `owner-fulfillment`, `stock-reservations`, `customer-payment-channel` | Pass with fake channel; collection deducts once, and does not record payment. |
| Customer amendment, re-quote and cancellation | `owner-quote-workbench`, customer payment/channel suite; cancellation browser | Pass; cancellation now names the action and confirms its effect. |
| Advance receipt verification, pay-at-shop and refund recording | `customer-payment-channel`, `payments`, dashboard browser | Pass with synthetic bank references; refund field cannot reuse the receipt field. No live money movement tested. |
| Signed payment provider events, duplicate/late captures and pending refunds | `payments` | Pass using mocked provider evidence. Actual provider/bank integration remains a separate gate. |
| Receive / walk-in sale / correct count | `owner-catalog`, `stock-reservations`, dashboard browser, real local API | Pass; held stock stays distinct from physical/available stock. |
| Unknown opening stock and count below held stock | `owner-usability`, stock reservations, dashboard browser | Pass; unknown opens the count task, while receive/sale are unavailable until counted. |
| Fractional increments and concurrent stock changes | `stock-reservations`, `owner-usability` | Pass; no use of held units or silent stale overwrite. |
| Price-only update, unknown stock and explicit free price | `owner-quick-price`, owner facts, dashboard browser, real local API | Pass; stock is unchanged; routine path still uses two clicks from a visible row. |
| Inline mixed facts, clear one input, filter/page pending rows | Dashboard browser, owner facts and usability tests | Pass; clearing one fact keeps other edits; off-page pending names are visible. |
| Partial batch, conflicts, same operation retry, full receipt | `owner-facts`, dashboard browser | Pass; reload remaining rows keeps committed rows and revalidates unsaved edits. |
| Mark a known tracked count unknown | Current UI/service contract review | No standalone tracked-stock “Mark unknown” control is provided. Blank input never performs this operation; no new clearing policy was invented. |
| Catalog search/filter/sort/25-row pages at 3,000 products | `owner-catalog-pages`, `catalog-retrieval-scale`, browser paging/filter | Pass for bounded API traversal; intended old-device speed remains unmeasured. |
| New product, original photo, Tamil alias and saved proposal | `owner-catalog`, `catalog-proposals`, `owner-editor-save`, dashboard browser | Pass; photo upload failures keep unsaved protection. |
| Clone draft, confirm five merchant facts, publish/hide/reject | Catalog/editor suites and expanded dashboard browser | Pass; clone identity is separate; publication/hiding/rejection remain deliberate. |
| Import progress, exceptions and staged source ownership | `owner-catalog-pages`, `catalog-bulk`, `catalog-reference-photos` | Pass for scoped, bounded reads and preserved provenance. |
| Agent search diagnostic after catalog changes | `owner-catalog`, dashboard browser | Pass; only published approved facts reach customer search. |
| Transcript, voice/photo, visual cards and delivery state | Owner/catalog/media/channel regression suites, message browser | Pass with fixtures; no new real recording or handset playback tested. Transcript remains the existing last-100-message window. |
| Manual takeover, acknowledgement and return | `owner-fulfillment`, `owner`, dashboard browser, local API | Pass; composer eligibility follows server-confirmed control. |
| Unsent manual reply, lost acknowledgement, expired window | Owner/channel regressions, expanded message browser | Pass; draft remains; retry retains the same operation ID. |
| Global assistant pause versus one-chat return | Owner/channel regressions, dashboard browser, local API | Pass; returning one chat does not lift shop-wide pause. |
| Settings, usage totals, exact costs, billing-month refresh | `owner`, cost/rate suites, dashboard browser | Pass with synthetic account analytics; unknown charges are not invented as zero. |
| Message examples and their language/stage filter | `owner-catalog`, gallery browser and real local API | Pass; preview buttons are disabled and do not perform commerce actions. |
| Initial/expired sign-in, forbidden shop, CSRF/store isolation | `owner`, `owner-quote-workbench`, owner facts, dashboard browser | Pass; loaded drafts stay in the original tab during sign-in recovery. |
| Offline, delayed refresh, stale failures and nonoverlapping polling | Order browser, `owner-polling`, catalog page tests | Pass in emulation; no optimistic false save or automatic unknown-send duplication. |
| Owner language and customer language separation | Locale/browser, inventory-flow language tests | Pass for daily controls; advanced copy still has English fallbacks. Native Tamil review pending. |
| Optional teaching help, keyboard close and focus return | Expanded browser at 1920, 768, 390 and 320 widths | Pass; four task guides and direct task links; no automatic mutations. |
| Narrow/desktop layouts and enlarged available widths | Seven-width dashboard and eight-size order checks | Pass at 320–1920 CSS pixels. Physical keyboard, safe areas, actual zoom and screen reader remain open. |
| One short demonstration is enough for a novice | Operator guide and proposed staff exercise | **Not yet established.** Must be measured with intended staff; no universal “anyone can use it” claim. |

## What changed after the earlier report

The previous two reported conversation failures were caused by the locally created **SQL_ASCII** database: `left(text,500)` could cut Tamil bytes inside a character before the pg client decoded them. The same files pass 42/42 in a fresh UTF-8 database, and the full current suite passes 842/842. The prior hosted commit's Project checks also completed successfully. No customer-understanding assertions were weakened and no conversation engine change was required. CONTRIBUTING now states the UTF-8 requirement.

The code review also covered field names/labels, focus targets, semantic controls, modal focus and narrow layout against the [Web Interface Guidelines](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md). Browser accessibility-tree checks are not a substitute for a physical screen-reader session.
