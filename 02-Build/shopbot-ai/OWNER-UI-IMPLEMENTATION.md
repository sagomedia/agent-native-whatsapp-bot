# Minimal ShopBot UI implementation

Prepared for VPS deployment on 11 October 2026 on `codex/minimal-owner-ui-vps`. The redesign from `a2c4c46` is combined with the exact source manifest of the installed release `preview-a437b62fc41a` (all 180 source files verified). The unavailable SMB checkout was not edited. Existing visual WhatsApp rendering, schema 23, quantity checks and production dependencies are retained. Deployment evidence is recorded separately in the parent workspace.

## Changes

- One shared neutral / white / charcoal / teal theme for the owner dashboard, customer chat, simulator, upload controls, errors and existing privacy page.
- Products retain the quick searchable list, with a dedicated URL-addressable full inventory view. English, Tamil, Tanglish, brand and existing catalog terms remain searchable. Inventory has one Filter control, visible applied filters, four columns, alphabetical order and 25-product pages. Phone inventory uses cards. Returning from an item preserves search, filters, page and scroll position.
- Product entry has one name field and one AI suggestion action. Main fields are photo, name, price, selling unit and optional stock; other fields stay in More details. Price and stock remain owner-entered. AI suggestions retain the current selling unit when already established. Reviewed publishing, hidden drafts, copying a product, image normalization and product-version checks retain their backend contracts. The interface explains that saving a draft hides a product. Switching products protects unsaved changes; browser close warns. The phone list and editor are separate screens with Back navigation.
- Conversations use a familiar inbox, compact messages, explicit preview / queued / delivery status, a collapsible customer list and Take over & reply at the composer. Older history stays in place when new messages arrive, with a New messages action. Phone conversations open separately with Back navigation. Unsent replies stay associated with their customer during browser Back / Forward; explicit switching asks before discarding them. Manual sends retain their idempotency key and operator revision.
- Requests show Active and History, the real fulfillment stage, compact item summaries, expanded details and the next valid action. Notification choices belong to each request. Declining and cancellation ask for confirmation. Pickup does not imply payment.
- Connections & usage show readable connection, assistant and USD budget sections. Exact accounting and unsettled reservations are available in a disclosure. Recent activity starts with five entries; all loaded entries can be shown. Connection and blocked-budget problems remain visible from daily work screens.
- Shared keyboard focus, semantic navigation links, labels, Tamil font fallback, reduced-motion handling, missing-photo fallback and small-screen layouts.

The snapshot contains no saved customer display names or phone numbers. The UI uses `Customer · short conversation ID` rather than inventing names or numbers. Existing API limits remain: 100 conversations / requests, 200 messages per conversation and 20 loaded activity entries. No new owner preferences, bulk mutations, payment flows or external notifications were added.

## Validation

- `npm run build` passes (TypeScript client/server and Vite production build).
- Entire integration suite: **259 passed, 0 failed**, against a disposable PostgreSQL container. It covers owner authorization, product publication/versioning/photos, fulfillment, delivery permissions, duplicate prevention, customer workflows visual WhatsApp ordering and the new inventory/request/reply-window helpers.
- Catalog cleanup checks: **4 passed**, using the preserved original catalog fixture. The app-only snapshot does not include its sibling `01-Input` folder, so that source path was supplied to the test module without changing the cleanup code.
- `scripts/check-owner-ui.mjs` passes in a separate headless Chromium with synthetic API responses. Checks include product search/pagination/stock filters, AI preservation of price/unit, review-before-publishing, unsaved edits, conflict recovery, edits made during asynchronous reloads, unavailable customer links, per-request notification payloads, request history, takeover/manual reply, idempotency/revision payloads, browser Back/Forward drafts, restored inventory scroll, older-history scrolling in both chats, photo attachment/cancel, preserved grouped visual messages and product actions in both chats, and desktop/390px layouts without page overflow.
- `git diff --check` passes.

Screenshots are in `artifacts/owner-ui/` (ignored build artifacts), including products, inventory, conversations, requests, settings and customer / simulator pages. Images and automated browser checks use synthetic records; they are not screenshots of the live shop.

## Repeat browser checks

Start Vite on a local port:

```sh
node_modules/.bin/vite --config apps/dashboard/vite.config.ts --host 127.0.0.1 --port 5179 --strictPort
```

With Playwright available in the test environment:

```sh
node scripts/check-owner-ui.mjs
```

Optional environment variables: `PLAYWRIGHT_MODULE` (path to Playwright's `index.mjs`), `CHROME_BIN` (installed Chromium executable), and `OWNER_UI_URL` (defaults to `http://127.0.0.1:5179`). The verification script intercepts API requests; the Vite server alone is not a connected owner dashboard.

## Transfer to the main checkout

The sibling `owner-ui-implementation.patch` contains the tracked implementation and checks. This deployment checkout also includes the newer visual WhatsApp backend; the original UI-only patch is based on `2ef7ec9`. This local Git copy is the application root, whereas the original project contains the app under `02-Build/shopbot-ai`.

After checking that the target app is based on the same code and preserving any newer work, run from the original project root:

```sh
git apply --check --directory=02-Build/shopbot-ai /absolute/path/to/owner-ui-implementation.patch
git apply --directory=02-Build/shopbot-ai /absolute/path/to/owner-ui-implementation.patch
```

For an app-root checkout, omit `--directory`. Resolve conflicts with any later app changes rather than replacing the target files wholesale. Run the build and applicable tests there before deployment.
