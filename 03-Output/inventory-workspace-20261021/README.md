# Inventory workspace: more facts, fewer acknowledgments

The new owner inventory screen uses a dense product table and a compact record with grouped fields and sections. It replaces five publication checkboxes with one review of actual values and **Confirm & publish**. The accepted baseline is `9b7bafe`; scope and reference-led design were committed as `8eee919`. This continues draft PR #54 and acceptance issue #52.

## What the references changed

[Zoho Inventory's item overview](https://www.zoho.com/us/inventory/help/items/item-details.html) distinguishes on-hand, committed and available stock. Its [item editing guide](https://www.zoho.com/us/inventory/help/items/item-managing.html) uses an Edit/change/Save path. We applied that separation of visible facts from adjustment actions.

[Odoo's form documentation](https://www.odoo.com/documentation/19.0/de/developer/reference/user_interface/view_architectures.html) describes column groups, responsive forms and tabbed sections. Its [product documentation](https://www.odoo.com/documentation/19.0/applications/inventory_and_mrp/inventory/product_management/configure/type.html) ties inventory actions to the record. We applied those structures to ShopBot's existing fields and operations. These are observations from public documentation, not access to either company's internal design system.

The full [design decisions and layout](DESIGN.md) explain the chosen table/record approach and its tradeoffs. No warehouse, supplier, accounting, forecasts or other unsupported controls were added.

## The implemented screen

- **Inventory table:** product name, code, brand, Tamil name, price/unit, on-hand, reserved, available stock, visibility and Edit/Price/Stock actions. Nine complete product rows fit at 1440×1000. Search, filters, New product and counts share a compact toolbar; bulk facts, CSV and drafts share one tools row.
- **Product header:** actual identity, code, visibility and four compact facts. Values remain visible above the record sections. The desktop list keeps product switching/search/pagination available.
- **General:** name, image preview, price/status, selling unit, quantity increment, size, brand, type and product code. New products retain an optional opening count.
- **Selling details:** pack/loose basis, pack contents, partial quantities, continuous length and specifications. These remain real editable fields, with the same selling-basis checks.
- **Stock:** movement tasks, physical-count preview, reservations and history. Order stock exceptions open this section directly. Unknown stock begins with counting and remains distinct from zero.
- **Photos:** upload, exact/reference source evidence, original photos, staged photo choice and an explicit photo/no-photo option. Removing the five acknowledgments does not publish an unconfirmed staged reference as an exact image.
- **Customer search:** Tamil/Tanglish names, aliases, search terms and the real saved-catalog diagnostic. All sections remain mounted so changing sections preserves edits.
- **Phone/tablet:** a native section selector, labeled inventory records where columns become too narrow, 44px form and primary-action controls, shorter action text and compact repeated metadata. Short Tamil screens retain at least 130px of initially visible form content above the action bar in the exercised fixture.

The product editor contains **zero checkboxes**. Partial-quantity behavior is a normal select field. CSV preparation and the explicit free-item exception in the inline facts grid retain their existing business safeguards.

## Saving and publishing

| Work | Behavior |
| --- | --- |
| Save a draft | Saves the working record and staged photos; no merchant certification or customer publication. |
| Enter a price | Selects priced status automatically. Clearing it selects price-to-confirm. Zero requires the explicit free status. |
| Review publication | Validates the entered facts and opens a compact value summary. Invalid reviews do not even prepare a draft. Errors identify the relevant section/field. |
| Confirm & publish | Sends the existing server-required identity/photo/unit/price/stock confirmations together, following this explicit human action. Server validation, versions and audits remain intact. |
| Later ordinary edit | Retains an already approved no-photo choice; uploading a new exact photo selects it. Unknown stock stays unknown. |
| Uncertain stock write | Keeps the task and original retry payload. Product switching is blocked while recovery is required; reloading metadata does not change the payload. |

The publication summary shows the product/photo, price or price-to-confirm, selling unit, increment, physical count or Unknown, selling-basis sentence and changed fields. It replaces repetitive acknowledgments with one explicit review; it does not silently mark imported facts as verified.

## Application-wide design map

| Owner page | Information/workflow retained |
| --- | --- |
| Today | Actual orders, precise stages, help requests, send exceptions, direct work shortcuts and shop checks. |
| Orders | One-sheet quote, photos, editable suggestions, payment/stock context, approval, pickup and direct stock repair. |
| Messages | Search/worklist, readable transcript, older messages, customer order link and reply/takeover eligibility. |
| Products | New dense table and sectioned record, plus all existing catalog/draft/source/stock/bulk functions. |
| Settings | Grouped connection/assistant/usage/cost/activity information, exact and unknown cost details, and section navigation. |
| Message review | Actual preview content, stage filters, retry/recovery and sending restrictions. |

This revision changes the inventory/record structure and its stock-repair links; the other pages retain the verified owner design from the prior pass. [Earlier complete page review](../page-completeness-20261021/README.md) and [function matrix/teaching guide](../workflow-check-20261021/README.md) remain relevant.

## Screenshots

All evidence uses synthetic data and production assets. [Previous table](../owner-design-20261021/evidence/catalog-1440.png), [previous editor](../owner-design-20261021/evidence/product-editor-1440.png).

[New table](evidence/inventory-1440.png) · [General record](evidence/general-en-1440.png) · [Selling details](evidence/selling-en-1440.png) · [Stock](evidence/stock-en-1440.png) · [Photos](evidence/photos-en-1440.png) · [Customer search](evidence/search-en-1440.png) · [Phone inventory](evidence/inventory-390.png) · [Tamil 320px record](evidence/general-ta-320.png) · [Single publication review](evidence/single-publication-review.png) · [Tamil phone publication](evidence/publication-ta-320.png).

## Verification

- Production build/typecheck, full UTF-8 PostgreSQL suite **848/848** with zero skips, and Python catalog checks **4/4** pass. Five new tests cover publication validation and its error destinations, explicit unknown values, zero/free distinction, number precision, selling basis and malformed specifications.
- Real-service inventory browser check passes **60 combinations**: five sections, two languages, six viewport sizes. It verifies keyboard tabs, edit retention, zero editor checkboxes, stock values, table density, short-phone content, cached navigation style isolation and English/Tamil phone publication dialogs.
- Actual synthetic create/edit publication verifies no writes before final confirmation, no writes for invalid reviews, required confirmation payload, no-photo choice retention, automatic priced status and unchanged unknown stock.
- Existing daily-task suite passes 18 groups, including uncertain stock recovery across metadata refresh and blocked product switching, drafts/photos/aliases/clone/publish/hide/reject, bulk recovery, payments/refunds, language and authentication.
- Existing page-completeness suite passes eight groups; quote acceptance passes eight viewport sizes; production design checks pass 36 page layouts and 12 English/Tamil short-phone order combinations.
- Actual local owner API workflow checks retain draft save/reload, truthful quote/channel state, acceptance → ready → collection, real holds, price/count save, pause/resume and takeover eligibility.

[Machine-readable results](VERIFICATION.json) and selected output logs are in this folder. `scripts/check-inventory-workspace.mjs` rejects remote, nonsynthetic or sending-enabled fixtures. It blocks writes during layout/invalid-review checks, then performs actual publication in the disposable schema. Restart the preview to reseed before repeating mutation checks.

To reproduce, build from `02-Build/shopbot-ai/` with Node 22, installed dependencies, FFmpeg and disposable UTF-8 PostgreSQL. Start `scripts/owner-usability-preview.ts` on port 3044 using the disposable local `DATABASE_URL`. Set `PLAYWRIGHT_MODULE` to an installed Playwright module, then run `node scripts/check-inventory-workspace.mjs`. Existing browser suites use their local fixture/dev-server configuration. The preview is reseeded after mutation checks for review.

No production deployment, live AI calls, customer sends or money transfers. Actual novice/staff acceptance, native Tamil review, physical phone keyboard/safe areas/zoom/screen reader, older-device/weak-network timing and live channel/payment acceptance remain open in [issue #52](https://github.com/sagomedia/agent-native-whatsapp-bot/issues/52).
