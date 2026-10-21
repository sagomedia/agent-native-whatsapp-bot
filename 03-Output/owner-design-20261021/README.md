# Owner interface design revision — 21 October 2026

The owner interface now uses a consistent shop work area across Today, Orders, Messages, Products, Settings and Message review. The revision fixes crowded navigation, oversized summary blocks, weak form hierarchy, phone action stacking and misleading transitions. It continues the verified functionality at `0f591b6`; accepted scope was committed as `648b21a` on the existing PR #54.

## What changed and why

| Area | Change | Effect on daily work |
| --- | --- | --- |
| Shared navigation | Stable desktop side navigation; compact phone header and four daily bottom destinations; consistent SVG icons | The current location and next destination remain easy to find. Settings, language and help stay available. |
| Today | Compact order count and shortcuts; real orders come before repeated help details; meaningful quote/stock/payment/pickup labels | A real order fits on the first 390-pixel phone screen. On desktop, five sample orders fit where the previous layout showed roughly two. |
| Orders | Explicit stage selector on the worklist at phone/tablet sizes; stronger queue selection; clearer editable versus approved values | Every stage is discoverable. Opening an order gives its items more space while retaining status, Back and conversation controls. |
| Messages | Larger conversation text, clearer incoming/outgoing surfaces, readable context and consistent actions | The customer request is easier to scan; takeover, reply eligibility and order links remain visible. |
| Products | Price, available stock and visibility stay grouped; three phone actions share one row; full editor gets section shortcuts | Routine price/count changes stay close to the product. Additional details and all five publication checks remain reachable. |
| CSV facts | Phone previews become labeled cards with price and stock before/after plus result | Reviewing changes no longer requires sideways scrolling. Pagination, chunking, receipts and recovery remain intact. |
| Settings | Readable panels plus sticky Connection, Assistant, Usage & costs and Recent activity links | Operators can jump to a section while keeping connection state, costs and uncertainty information. |
| Message review and dialogs | Consistent filters, spacing, text, boundaries and focus; phone dialogs fit their viewport | Supporting screens use the same controls and visual hierarchy as daily work. |
| Loading | New order/message filters show a loading state until their own response arrives | A previous stage's data can no longer briefly appear as an empty new stage. Search stays mounted and usable. |

White work surfaces, a restrained grey-green background, deep teal actions and semantic amber/green/error states replace inconsistent blue/default styling. Arial and the bundled Tamil font retain familiar forms. Primary text contrast is measured at **6.69:1**. Control boundaries and keyboard focus are stronger. Copy for the new daily navigation and section controls is available in Tamil; advanced English fallback still exists and needs native review.

## Visual evidence

All screenshots use isolated synthetic shop data. The before captures are from `0f591b6`; the after captures use this revision's production build. Synthetic IDs/timestamps differ between reseeds. Evidence shows actual loaded content, not loading placeholders.

| Before | After |
| --- | --- |
| [Desktop Today](evidence/before-overview-1440.png) | [Desktop Today](evidence/overview-1440.png) |
| [Phone Today](evidence/before-overview-390.png) | [Phone Today](evidence/overview-390.png) |

Additional screens: [Quote editor](evidence/quote-editor-1440.png), [Orders desktop](evidence/requests-1440.png), [Orders phone](evidence/requests-390.png), [Messages desktop](evidence/conversations-1440.png), [Messages phone](evidence/conversations-390.png), [Products desktop](evidence/catalog-1440.png), [Products phone](evidence/catalog-390.png), [full product editor](evidence/product-editor-1440.png), [Settings desktop](evidence/connections-1440.png), [Settings phone](evidence/connections-390.png), [Message review](evidence/message-review-1440.png), [320px price dialog](evidence/price-dialog-320.png), [320px CSV preview](evidence/csv-preview-320.png), [320px Tamil order](evidence/ready-order-ta-320.png).

## Functional preservation and verification

No commerce/service rule or database migration changes in this revision. One-sheet quotes, versioned drafts, optional matching, photos, customer approval, stock reservations, once-only collection, cancellation/refund records, manual reply safeguards, catalog publication checks, bulk recovery, billing/access controls and help retain their existing behavior. The [function matrix and teaching guide](../workflow-check-20261021/README.md) and [page completeness review](../page-completeness-20261021/README.md) still apply.

- Production build/typecheck pass; full UTF-8 PostgreSQL integration suite **843/843**, zero skips; catalog cleanup **4/4**.
- Daily-task acceptance passes 18 scenario groups, including uncertain writes, mixed/off-page facts, stock retry identity, publication, cancellation/refund, Tamil and expired sign-in.
- Page-completeness acceptance passes eight scenario groups, including failed reads, visible filters, unknown costs and older transcript access.
- Quote acceptance passes eight viewport sizes from 320×640 through 1920×1080, including drafts, approval, offline/retry and collection.
- New real-read design acceptance passes all six pages at 1920×1080, 1440×1000, 1024×600, 768×1024, 390×844 and 320×640: 36 page layouts, held-response transitions, section jumps, phone product actions, dialogs, CSV cards, contrast and 12 seeded order/language combinations. The smallest observed item region is 170.8px, with action labels contained.
- Actual local API browser actions pass: draft save/reload, offered quote with truthful disabled-channel state, acceptance→ready→collection, seeded reservation consumption, price/count save, pause/resume and takeover eligibility. The rehearsal was reseeded afterwards.

Machine-readable detail: [VERIFICATION.json](VERIFICATION.json). Selected logs are in [evidence](evidence/). Browser checks use Chrome and an externally supplied Playwright module; `scripts/check-owner-design.mjs` defaults to the isolated preview on port 3044 and rejects a nonlocal URL or a nonsynthetic/sending-enabled fixture. That design check blocks all real writes and intercepts one synthetic CSV preview for layout. The separate local API check makes real mutations only in its disposable synthetic schema.

Reproduce from `02-Build/shopbot-ai/` using Node 22, installed dependencies, FFmpeg and a disposable UTF-8 PostgreSQL database:

```bash
npm run build
DATABASE_URL=postgres://USER@127.0.0.1:PORT/DISPOSABLE_DB npm run test:integration
python3 -m unittest discover -s scripts -p 'test_catalog_cleanup.py'
DATABASE_URL=postgres://USER@127.0.0.1:PORT/DISPOSABLE_DB PORT=3044 node --import tsx scripts/owner-usability-preview.ts
```

In another terminal, set `PLAYWRIGHT_MODULE` to an available Playwright module and run `node scripts/check-owner-design.mjs`, followed by `node scripts/check-owner-local-api.mjs`. The latter mutates the training shop; restart the preview to reseed before repeating. Existing intercepted browser suites use the local dashboard dev server and their documented environment variables.

## Remaining acceptance

Automated checks establish the exercised behavior and responsive layout. A real novice/staff teaching exercise, native Tamil copy review, physical phone keyboard/safe areas/zoom/screen reader, older-device/weak-network timing, and live channel/payment acceptance remain open under [issue #52](https://github.com/sagomedia/agent-native-whatsapp-bot/issues/52). The candidate is on [draft PR #54](https://github.com/sagomedia/agent-native-whatsapp-bot/pull/54). No production deployment, live AI call, customer send or money transfer was performed.
