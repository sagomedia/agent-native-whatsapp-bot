# Owner process screens: findings and implementation

The inventory redesign and this follow-up have **not been deployed to the VPS**. They remain a local candidate in [draft PR #57](https://github.com/sagomedia/agent-native-whatsapp-bot/pull/57). The preceding dashboard source was merged in PR #54; merging source and deploying the running application are separate operations.

The user asked for a review of the individual screens within every owner process, preserving enough information and making work easier to learn. [Accepted scope](SCOPE.md), baseline `dd1f425`, scope checkpoint `3b07e0b`. [Issue #52](https://github.com/sagomedia/agent-native-whatsapp-bot/issues/52) tracks the candidate and outstanding acceptance.

## What changed

| Observed problem | Implemented behavior |
| --- | --- |
| The CSV instructions filled the first short-phone screen; the actual upload control was below it. | Export and upload appear first. Detailed column/stock rules remain in an expandable section. The upload control fits above navigation at 320×640. |
| A server-saved CSV preview had no durable route back after refresh. | The URL retains the batch ID. Reload reads its actual recorded state, remaining rows and chunk. It does not apply anything. Unknown or inaccessible previews show retry and never display another batch's apply controls. |
| Returning from a saved CSV preview required a discard-style confirmation. | Back to Products is one click for a known saved preview. Browser Back restores that batch. A write in progress or uncertain result remains guarded. Starting a different CSV still confirms replacement of the current working preview. |
| CSV apply/receipt controls were far below the preview; a first sticky version consumed excessive phone space. | A compact sticky action bar keeps Apply reachable, with receipt and new-file actions sharing a row on phones. The preview itself remains scrollable. |
| Fixing stock from an order had no direct way back to that order. | The exact product opens in Stock with a Back to order link. The return clears order search/paging so the selected order is reachable even if its stage changed. Uncertain stock recovery blocks the return until resolved. |
| Opening a customer conversation from an order lost the immediate order context. | The conversation retains a direct return to the originating order alongside the existing link to all that customer's orders. |
| Product sections reset to General after refresh. | All five sections are represented in the URL. Switching sections preserves input, while refreshing restores the selected section. Stock-save refresh retains Stock. |
| Quick price/stock saving could reopen a previously selected product instead of leaving the owner in the inventory list. | Metadata refresh does not change the working route. Quick saves retain the inventory even when that product was opened earlier. |
| Quick price and stock quantities required a pointer action to submit. | Enter submits through the existing validation and guarded save paths. Quick price focuses its field on desktop; stock keeps reservations and exact retry identity. |
| Catalog matching retry changed the actual search by appending a space; long source text could exceed the search bound. | Retry repeats the same query; initial text is bounded to 200 characters. Opening matching focuses the search field. Superseded responses do not replace current results. |
| A selected-draft failure retried the list instead of the chosen draft; closing review could still allow a late selection to open a record. | Retry selected draft repeats that exact read. Closing/changing filters cancels selection navigation. Failed filters hide stale selectable rows. Closing/reopening review retains its list page. |
| Sending-disabled/closed-window conversations still offered “Take over & reply.” Customer photos had no explicit full-image action. | Such conversations offer Handle conversation and explain reply eligibility. Original customer photos have an authenticated full-photo link. No reply or delivery capability is invented. |
| The advance action scrolled to payment details without focusing the field; short transaction references silently disabled verification. | Record advance focuses the transaction field. Advance and refund inputs explain their six-character minimum. Existing actual-bank verification and refund-recording semantics remain. |
| A new order-return link collided with the compact Tamil product header. Screenshot review also found clipped product action buttons despite no document overflow. | The record's back bar now lays out navigation, product code and More actions in separate columns. A repair prioritizes Back to order, with inventory available in More actions. Phone action columns wrap labels within their bounds. Added overlap and internal clipping assertions. |

The changes use the existing shop colors, fonts, semantic statuses and grouped facts. No mandatory checklist or tour was added. Optional Quick help remains available. No database migration, new external dependency or commerce-service mutation rule was introduced.

## Coverage by process

The initial read-only browser audit captured **45 layouts**: six pages, matching, quick price, quick stock, CSV start and five product sections at desktop/390px/320px sizes. Findings were then checked against source and the existing workflow suites. The table distinguishes preserved behavior from changes; it does not claim a new design was necessary for every screen.

| Process and inner screen | Result / verification |
| --- | --- |
| Today work shortcuts | Existing clean task routes and precise stages retained; daily-task and completeness checks. |
| Today diagnostics, paused/channel notices and read failures | Visible exceptions, truthful sending state and retry retained; completeness checks. |
| Order worklist, stages, search and pagination | Existing bounded worklist and explicit record selection retained; daily-task/completeness checks. |
| Quote item entry and selling basis | Quantity/unit/price/free-item errors and direct correction retained; current quote suite. |
| Quote catalog matching | Exact-query retry, bounded initial search, current results and input focus improved; new inner-workflow checks. |
| Quote photo enlargement / original request | Existing full original photo inspection and request evidence retained; current quote suite. |
| Draft save/load/conflict, lost quote response | Saved drafts and exact quote recovery retained; quote and daily-task suites. |
| Customer changes and cancellation | Proposed-list quotation, unresolved-change blocking and explicit cancellation remain; source review, daily-task and integration checks. |
| Advance verification and refund record | Minimum reference length made visible; focus improved; actual bank/refund confirmation remains; new checks plus existing daily/integration coverage. |
| Acceptance, stock reservation, ready and collected | Payment stays separate from collection; actual reservation services retained; real local API and integration checks. |
| Order stock repair and conversation hand-offs | Direct return to the originating order added; new checks include uncertain stock recovery. |
| Inbox filters / conversation selection | Truthful filtered empty states and reply draft guards retained; completeness/daily-task checks. |
| Reply, takeover, expired window, lost response | Eligibility wording improved; retained reply drafts and exact retry verified by daily-task checks. |
| Transcript / earlier messages / attachment | Bounded history and recovery retained; authenticated full customer-photo link added; completeness/new checks. |
| Interpretation evidence | Optional retained evidence, failure retry and raw detail remain; completeness checks and source review. |
| Product General / Selling details / Stock / Photos / Customer search | Section route survives refresh; unsaved fields survive section changes; new checks plus 60 inventory combinations. |
| Product draft / publication / missing photo / unknown facts | One explicit value review retained; no invalid-review or pre-confirmation writes; inventory and integration checks. |
| Product source comparison / references / clone / hide / reject | Existing provenance, original images and destructive confirmations retained; daily/integration checks. |
| Quick price / quick stock | Enter submission, stable list route and guarded retry checked; exact holds/count rules retained. |
| Inline prices/counts / off-page edits / partial failure / receipt | Edited-only writes, pending edits and saved-row recovery retained; daily-task checks. |
| CSV export / upload / preview | Working controls moved ahead of detailed rules; real staging verified without applying merchant facts. |
| CSV chunks / response loss / reload / inaccessible batch | Mocked 60-row partial application exercises chunk progression and explicit continuation; real local preview/reload/navigation proves saved state and zero apply calls. |
| CSV receipts / expiry / replacement | Complete receipts, expiry and version checks remain; integration tests, responsive design and source review. |
| Unpublished drafts / source filters / selected record | Exact retry, stale-read protection and late-selection cancellation improved; new checks. |
| Import progress / failed source rows | Existing read/retry and provenance remain. Copy explains saved drafts and correction/reimport without exposing a terminal command as a shop action. Source-package reimport still requires the existing operator tooling. |
| Settings connection / assistant pause | Clear configuration and shop-wide pause remain; daily-task and actual local API checks. |
| Settings usage / exact costs / unknown charges / monthly analytics | Known-vs-unknown totals, detailed ledgers and month action retained; daily-task/completeness checks. |
| Settings recent activity | Bounded activity expansion retained; source and layout review. |
| Message review stage/language / accessible text / retry | Real preview content, disabled commerce actions and empty/error recovery retained; daily-task/completeness/design checks. |

## Verification and evidence

- Production build and typecheck pass.
- Full UTF-8 PostgreSQL suite: **848/848**, zero skips; Python catalog checks: **4/4**.
- New `check-owner-inner-workflows.mjs`: **11 scenario groups**, 16 English/Tamil layout combinations, exact stock retry, overlap/clipping checks and real CSV restore without merchant-fact changes.
- Inventory production check: **60 section/language/viewport combinations**, now including internal action-label bounds; actual synthetic create/edit publication.
- Existing daily-task suite: **18 scenario groups**; page completeness: **eight groups**; current quote suite: **eight viewport sizes**; owner design: **36 page layouts** and 12 short-phone order/language states.
- Actual local owner API rehearsal covers saved quote, customer-approval truth, acceptance → ready → collection, real reservations, price/count and pause/takeover. Mutation fixtures are reseeded afterward.

[Machine-readable evidence](VERIFICATION.json) records each result. Selected screenshots: [CSV before](evidence/csv-before-320.png), [CSV after](evidence/csv-after-320.png), [restored preview](evidence/csv-restored-390.png), [Tamil stock repair](evidence/stock-return-ta-320.png) and [conversation return/photo action](evidence/conversation-return-and-photo.png). Selected logs are also in `evidence/`.

Reproduce with Node 22, installed dependencies, FFmpeg and disposable UTF-8 PostgreSQL. Build the app, start `scripts/owner-usability-preview.ts` on loopback port 3044, set `PLAYWRIGHT_MODULE`, and run the named scripts from `02-Build/shopbot-ai/`. `check-dashboard-tasks.mjs` uses a local Vite fixture server; the other maintained browser checks accept `OWNER_UI_URL`. Use `check-dashboard-usability.mjs` for the current quote workflow: the older `check-orders-workbench.mjs` targets pre-usability labels. An exploratory dev-server check interrupted by hot reload was repeated against production assets; those harness issues were not treated as application defects.

## Remaining acceptance and useful next work

The source and synthetic checks do not establish actual novice learning or physical-device behavior. The remaining work is the intended staff exercise, native Tamil wording review, real phone keyboard/safe areas/zoom/screen reader, older-device/weak-network timing and fresh live channel/payment acceptance. Advanced import/evidence/settings copy still uses English where a reviewed Tamil translation is unavailable.

A source-package reimport action and a durable in-app history/list of CSV batches would be separate product features. The current saved CSV URL restores one authorized, unexpired batch; it is not a new import-job dashboard. No unsupported supplier, purchasing or warehouse controls were added to make the interface resemble a larger ERP.

No VPS deployment, live provider evaluation, customer message send or money transfer was performed in this pass. [Issue #52](https://github.com/sagomedia/agent-native-whatsapp-bot/issues/52) remains open for actual acceptance and release.
