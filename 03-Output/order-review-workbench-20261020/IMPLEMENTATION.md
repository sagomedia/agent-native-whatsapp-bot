# Orders review and quote workbench

Implements the owner's supplied Orders mockup and approved five refinements. Tracking: [issue #50](https://github.com/sagomedia/agent-native-whatsapp-bot/issues/50). This follows the deployed visual-shopping repair in PR #49; customer carousels are preserved.

## Owner experience

- Search the loaded worklist by order, customer reference or requested product. Needs review, Awaiting customer approval, Ready for pickup, History and Checkout reflect existing backend states. Customer amendments return the order to review. Checkout bills remain unsubmitted lists.
- Review a compact table with current catalog photos, quantity, selling unit, per-unit price and calculated line amounts. Unpriced amounts stay blank and the subtotal is explicitly incomplete. The warning jumps to the first unresolved row and opens its checks.
- Match a product using inline catalog search, including Tamil names and SKUs. The selected current product identity/version is validated on the server and carries through customer quote approval to the order. Requested wording remains visible. Manual items, free lines, selling basis and duplicate/uncertain quantities have explicit controls. No lines are automatically merged or removed.
- Save incomplete drafts to the shop database, with saved/unsaved/saving/error feedback. Saved drafts survive reloads and other devices; unsaved edits remain in memory during dashboard navigation and warn before closing. Concurrent saves, changed order revisions and withdrawn amendments are rejected without overwriting the browser's edits. Owners can load the saved draft or explicitly start from the current order.
- Send a complete quote for customer approval. Quoted items are read-only while waiting. An expired quote can be reviewed and replaced. If notification was off or unavailable, send the existing current quote from its summary; delivery attempts remain deduplicated and unknown delivery points to the conversation. No approval, payment, shelf confirmation or pickup is implied by sending.
- Keep advance verification/refund, customer amendment review, merchant acceptance/reservation, packing checks, collection, cancellation and conversation access. Catalog matching and draft saves do not reserve stock. Quote approval remains a customer action.
- Wide screens use queue/editor/summary. Smaller laptops place the summary below the table. Phones use queue/detail navigation, labeled stacked fields, persistent bottom Save/Send actions, and visible keyboard focus.

## Scope and migration

New authenticated owner draft read/save and current quote notification routes reuse owner access/origin checks, store locks and audits. Migration 40 adds `order_quote_drafts`; existing order, catalog, payment and inventory data are unchanged. Quote-line validation accepts a deliberately selected catalog SKU/version and protects its current name, selling unit and quantity increment. The old separate quote form is removed so the page has one editor.

The worklist still uses the snapshot's latest 100 loaded requests; counts/search are labeled accordingly at that limit. Existing recent-conversation bounds also remain. Server-backed draft saving is explicit through Save draft, rather than claiming automatic saving.

## Evidence and acceptance

The browser script `scripts/check-orders-workbench.mjs` intercepts every API request with synthetic fixtures. It verifies 1586, 1366, 1024, 390 and 360 px layouts, no horizontal overflow, phone actions, durable save/reload, failed-save recovery, matching and source wording, manual/duplicate checks, quote payload and stage changes, notification choice, and changed-order protection. Screenshots in `evidence/` are actual browser renders of those fixtures, not live merchant data. Photos/names are paired existing demo assets; prices and recorded advances are synthetic.

Integration tests cover authenticated draft persistence, idempotent retry, concurrent windows, store isolation/origin checks, line membership, revisions, current catalog matching, customer consent, stale SKUs/units/increments, amendments, expired quotes and the saved-quote notification route. The populated old-schema migration rehearsal now includes the draft table and retains its prior data-preservation assertions. Final check results and deployment identity are recorded separately after verification.

The owner's live workflow review remains open. Automated fixtures do not establish fresh real-device WhatsApp delivery, live payment receipt or merchant stock accuracy.
