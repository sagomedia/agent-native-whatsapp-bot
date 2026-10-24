# Minimal ShopBot owner redesign

Implementation of the approved October 22 redesign and item-identification preview. Source starts from published `main` at `bb5e509`; scope checkpoint `b505259` records the owner's accepted flow before implementation. Tracking: https://github.com/sagomedia/agent-native-whatsapp-bot/issues/69.

## Result

- `/owner` now opens the minimal Orders, Chats, Products and Settings workspace. Desktop uses a sidebar and split work panes; mobile uses bottom navigation with list/detail screens.
- Orders have New, Ready for pickup and Completed stages. A revised bill is optional in New. The original customer-seen bill remains unchanged while owner-reviewed lines and totals are stored separately.
- Item identity opens a native search dialog showing the original request. Owners can choose a catalog product or enter a store item for that order without creating a catalog product. Quantity and unit price remain directly editable.
- Zero, unknown and insufficient recorded stock are advisory in customer checkout and the redesigned owner flow. Older active reservations are released transactionally when the order enters the redesigned review path; physical on-hand stock is not silently deducted by the new advisory path.
- ₹10 advance verification records the owner and time after the owner checks their bank app. A bank transaction reference is optional in this flow, and the advance does not mark the whole bill paid.
- Products save image, name, price and optional stock in one transaction. Suggested descriptive fields remain editable; owner-entered name, unit, price and quantity are preserved during AI filling. Product identity and stock versions prevent stale writes.
- Chats include actual customer names/phone numbers, human/bot handover, media, manual replies, search and Needs reply filtering. The filter represents work needing a reply rather than unread messages.
- Settings exposes language, automatic replies, shop-name editing, actual reply previews and compact usage/connection information. Shop address/contact persistence and provider account changes are not present in the existing backend and are not fabricated.

## Demo prices

The bundled demo products already contain ordinary prices. Imported demo records can contain separate matching-unit indicative price metadata. The product list can display that demo amount, but authoritative customer billing requires explicit preparation rather than treating estimates as verified merchant facts globally.

`scripts/prepare-demo-prices.ts` is a dry-run-by-default preparation tool for one explicitly selected synthetic store. It accepts `DATABASE_URL`, `OWNER_STORE_ID` and `SHOPBOT_CATALOG_ACTOR`; applying requires `--apply --hash=...` from its preview. It converts only valid matching-unit values, preserves source metadata in the owner audit, and leaves merchant verification unchanged. It is never called by startup or migration. No existing shop database was modified during this work.

## Verification

Build/typecheck passed, the full PostgreSQL suite passed **869/869** with zero skips, catalog cleanup passed **4/4**, and the browser rehearsal passed **29 checks**, nine successful writes and zero console errors. Results and screenshots are recorded in this directory's evidence. The browser harness uses an isolated UTF8 PostgreSQL schema, local Fastify API injection and synthetic customers. It never sends messages to external customers or enables paid inference.

Browser checks exercise real local API writes for photographed product creation, stock correction and reload, shop-name editing, zero-stock selection, an unlisted store item, optional revised bill, readiness, collection and owner-checked advance receipt. Layouts are inspected at 1440, 390 and 320 pixels.

## Deployment boundary

The redesign was subsequently deployed to the existing VPS as release `preview-ebb2f177e88a`, source `91e8ca3`, with 90-second audio preservation and schema 43. See [DEPLOYMENT.md](DEPLOYMENT.md) for backups, retained records, ordinary demo prices and live verification. A source rollback does not undo database changes or commerce events.

The existing QR request already includes `tr` and `tn`; recipient-app/bank visibility of those fields still requires small real-device payment tests. Automatic settlement verification is not implied by generating a QR or by a customer saying they paid.
