# Implementation and verification

**Follow-up correction:** the earlier two local conversation failures came from the test database's SQL_ASCII encoding. The UTF-8 rerun passes 842/842; see [complete workflow check](../workflow-check-20261021/README.md) for current fixes, evidence and the operator teaching guide. Earlier results below are retained as historical evidence.

## Outcome

The React owner dashboard now has four familiar daily destinations, direct Today shortcuts, one responsive order sheet and simpler price/stock actions. Existing mutation services remain responsible for price, stock, reservations, customer consent, payments and fulfillment. No schema migration is needed.

| Task | Implemented behavior | Evidence |
|---|---|---|
| Find daily work | Today shows global active/help/ready totals with direct links; diagnostics are collapsed. | Six-view browser checks; local API screenshots |
| Quote an order | Resolve N items focuses the first missing fact. Complete quotes retain one Send action that saves the versioned draft and submits. Optional catalog match, store items, orange suggestions and original photos remain. | Order browser acceptance |
| Follow an order | Stage-specific acceptance, packing/readiness and collection remain beside amendments, payment/refund controls and delivery state. | Existing full regression and order browser lifecycle |
| Find older work | Server-scoped order stage/search/page and inbox search/help/page return bounded windows with global totals. Selected off-page records append without polluting the page result IDs. Search finds an item older than the first 100 and treats %, _ and backslash literally. | New PostgreSQL test with 130 orders and conversations |
| Update a price | Update price → Save price; current/new price and selling unit stay visible. Free requires explicit confirmation. Existing facts preview/apply, versions and stable retry identity remain. | Browser measured baseline 4 clicks; candidate 2; lost-response retry |
| Record stock | Receive, walk-in sale and count are explicit tasks. On shelf, held and available stay distinct; result preview uses exact milliunit arithmetic. Unknown opening counts and counts below holds remain guarded. | Stock utility tests; real local count save; frozen-payload retry even after product metadata refresh |
| Change several products | Visible-page inputs retain edited rows by SKU across filters/pages and same-tab task navigation. Only changed facts enter the existing versioned batch. Review, all-row review, recorded chunk apply, complete receipt download, retry and discard are available. Phone rows become cards. | Mixed price/count browser check and downloaded receipt; existing facts regressions |
| Handle a conversation | Manual takeover, eligible owner reply, unsent-reply guard, return to assistant, transcript/media and global-pause precedence remain. Inbox search queries message history. | Dashboard browser and owner regressions |
| Recover access | Initial 401/403 are distinct. Loaded 401 retains in-memory drafts, disables owner actions and offers sign-in in another tab; focus refresh resumes the original tab. Offline and delayed refresh keep loaded records. | Browser initial/loaded auth and offline checks |
| Language and advanced work | Saved English/Tamil owner preference changes daily labels without rewriting customer text. Full editor, draft/publish/photo/aliases, CSV facts, settings/usage and message gallery remain reachable. | Dashboard task browser and local API views |

## Source map

Paths are relative to `02-Build/shopbot-ai/`.

- `apps/dashboard/src/OwnerDashboard.tsx`, `owner-usability.css`: shell, navigation, inbox reads, access recovery and responsive scroll containment.
- `OwnerOverview.tsx`, `OwnerOrders.tsx`, `OrderQuoteEditor.tsx`: direct work, global stages/paging and focus missing quote facts.
- `OwnerQuickPrice.tsx`, `OwnerStock.tsx`, `owner-stock-preview.ts`: concise actions and truthful stock result preview.
- `OwnerInlineFacts.tsx`, `owner-inline-facts.ts`, `OwnerCatalog.tsx`: changed-only grid entry through existing catalog-facts services; full catalog workflow retained.
- `owner-locale.tsx`: daily owner controls, local preference only. Advanced help, diagnostics, several editor/review labels and server errors still fall back to English. Native staff copy review is pending; this is not a claim of complete Tamil localization.
- `apps/server/src/services/owner-read-query.ts`, `http/owner.ts`: validated, authenticated, store-scoped reads. Existing write authentication and business rules are preserved.
- `tests/owner-usability.test.ts`: new arithmetic, field-isolation and real PostgreSQL paging/search checks.
- `scripts/check-dashboard-usability.mjs`, `check-dashboard-tasks.mjs`: synthetic browser checks; every API request is intercepted.
- `scripts/owner-usability-preview.ts`: disposable loopback-only local preview with synthetic data and real local owner services. It does not run provider/channel workers.

## Verification

Environment: Node 22.22.1, headless local Google Chrome, disposable local PostgreSQL 18; no live AI calls or customer sends.

- Production build/typecheck: pass.
- Full suite: 840 tests, 838 pass, 2 fail, 0 skipped. Both failures also occur on untouched baseline `f3a982747e95e37bbe58e678ea43209b696f5b54`: `foundation-conversations.test.ts` Tamil list acknowledgement and `unified-understanding.test.ts` PVC type clarification. The baseline comparison is 40/42 across those files. [Issue #53](https://github.com/sagomedia/agent-native-whatsapp-bot/issues/53) tracks them; assertions were not weakened.
- Focused owner/read/facts/quote suite: 19/19 pass after final source edits.
- Python catalog cleanup: 4/4 pass.
- Order interaction checks: draft save/reload/conflict, missing-fact focus, original photo enlargement, optional match, manual store items, send+approval, external revision change, offline/reconnect, acceptance→ready→collection, stable footer and separately scrolling items. Viewports: 1536×1024, 1366×768, 1024×600, 390×844, 360×740.
- Dashboard task checks: navigation, owner reply and unsent guard, global pause precedence, price/stock uncertain retries, mixed inline updates and receipt download, editor AI preserves price/unit, usage analytics, disabled gallery actions, language preference and access recovery. All six views plus grid fit 360/390/1024/1536 widths without outer page overflow; no page errors.
- Actual local API browser check: six views at 1440 and 390, price saved as 3150 paise and physical count 18 through real services in an isolated synthetic database; no page errors.
- Measured price clicks: baseline `[Update price, Confirm checked price, Review price, Save price]`; candidate `[Update price, Save price]`. Typing, navigation to inventory and retries are excluded from this normal-path comparison.

The fixtures validate controls and business guards, not human task speed or live delivery. Backend failures and partial-batch conflicts stay visible and preserve recorded commits. On partial conflict, download the receipt and prepare a fresh preview from reloaded products; never assume all rows were applied.

## Remaining acceptance and release boundaries

The implementation packages are reviewable; WP6 physical/accessibility/performance checks and WP7 staff acceptance/activation remain open. Do not treat screenshots as completed device acceptance.

- Intended Tamil/Tanglish shop staff must run quote, price, stock, takeover and pickup tasks and review the Tamil labels.
- Test real phone keyboard/safe-area behavior, enlarged text/zoom, focus order and a screen reader. Headless viewport coverage does not establish these outcomes.
- Measure the intended older computer, weak network, transferred bytes and response/task times. No general performance speedup is claimed.
- Conversation transcripts retain the existing bounded last-100-message view; checkout lists retain their existing recent-conversation read window. The new order and inbox queue pagination does not turn them into unlimited history exports.
- Browser-only unsaved edits stay in memory in the current tab. Explicitly saved quote/product drafts use the existing server persistence; only language preference enters localStorage. Closing/reloading a tab can lose unsaved input. The sign-in recovery link keeps the draft-bearing tab open.
- Resolve the baseline conversation failures and verify hosted checks before release. Review the 90 inherited commits between `main` and the accepted source before any merge; this candidate must not silently replace that source with the older main.
- No production deployment, merchant-data change, budget/model switch or customer test send was performed. A later release still needs the existing backup, rollback and pilot gates.

## Reproduction

From `02-Build/shopbot-ai/`, with Node 22 and a disposable local PostgreSQL URL:

```bash
npm run build
DATABASE_URL=postgres://USER@127.0.0.1:PORT/DB npm run test:integration
python3 -m unittest discover -s scripts -p 'test_catalog_cleanup.py'
DATABASE_URL=postgres://USER@127.0.0.1:PORT/DB npm exec tsx scripts/owner-usability-preview.ts
```

The loopback preview defaults to port 3043, cleans its own temporary schema on SIGINT/SIGTERM, and deliberately refuses a non-loopback database URL. Keep the database process alive while viewing it. Run browser scripts against a local Vite server using `OWNER_UI_URL`, `PLAYWRIGHT_MODULE` and optionally `CHROME_BIN`. `PRICE_BASELINE_URL` enables the separate click comparison against a preserved baseline build. Evidence directories can be set with `ORDERS_EVIDENCE_DIR` and `DASHBOARD_EVIDENCE_DIR`.
