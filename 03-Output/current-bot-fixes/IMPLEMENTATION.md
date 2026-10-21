# Current bot fixes — Jev deferred

Jev remains a future-version experiment. This release uses the existing Gemini model and existing catalog, cart, payment and order controls.

## Confirmed cause and fix

Read-only saved evidence established that a spoken blade-to-plier correction was represented twice: as a fresh requested item with no count, and as a replacement targeting the existing blade row. The adapter emitted both operations. Two rows later selected the same actual plier SKU, one with count one and the other with an unknown count. Overlapping replacement/addition representations now become one grounded correction. Explicit extra items and different variants remain distinct.

A linked “keep these items; remove the rest” instruction is now compiled into a complement of current stable line IDs. Ambiguous kept items hold the entire linked batch and retain the original goal through a focused question. Answers revalidate version, offered row IDs and current state before applying one transaction. Negated, revoked, unrelated and stale evidence cannot authorize deletion. Removing one unit is distinct from removing a repeated entry.

Private transcripts, contact identifiers, credentials and database snapshots remain outside the repository.

## Customer presentation

- Product captions share a bounded builder: identity/variant, price, important count, reference-photo disclosure. Repeated brand/stock/warning prose is removed; out-of-stock warnings remain.
- Product-type clarification uses native buttons rather than repeating all product images. Existing diameters remain visible and counts stay in the cart.
- Unknown prices use `கடையில் சரிபார்த்து சொல்லப்படும்`; no fallback list or wholly unpriced cart displays a false zero quote.
- QR invitation and payment acknowledgement are shorter. Recipient and same-phone link remain available; pay-at-shop remains optional and recorded as unpaid. Claimed receipt is distinct from verified receipt.
- Eight-row invoices remain one image per page with a short caption. Accessible full text is retained, without automatically duplicating the full invoice in a second message. Missing count, identity, selling unit and price are distinguished.

## Indicative prices

At the user's request, a subagent was requested with `gpt-6-luna`, effort `low`, to propose realistic Indian prices. The artifact preserves requested-model provenance separately from the agent's generic reported model identity. These are model estimates with a few official manufacturer anchors, not merchant-confirmed selling prices or uniformly verified market prices.

`indicative-prices.json` contains 298 stable SKUs: 297 suggested amounts and one held for a selling-unit check. Price ranges, selling units, source versions, source links and provenance are retained. Obvious power-tool, pack-size and duplicate-price inconsistencies were reviewed and corrected. Proposal SHA-256: `589581b13cf004953959a07b5ae4e7e107138b56a4912a81168dc9bab61a654a`.

Migration 37 adds nullable, validated `products.indicative_price` metadata. The importer is restricted to the exact synthetic shop, uses a frozen versioned snapshot, locks and rechecks all rows, audits the batch and supports a no-write replay. It never changes `price_paise`, `price_status`, stock, selling policy, merchant verification or product photographs. Existing actual prices take precedence. Ambiguous selling bases remain pending.

The importer is compiled into the native release and required by the packaging check. A compiled-CLI regression exercises its deployed imports and early argument guards without development tooling or database access.

Cards display `சுமார் ₹…`; approximate invoice amounts use `~` and an indicative-price footer. These totals do not satisfy exact-quote completeness, merchant acceptance or payment truth. Shop-entered final prices still require the existing final quote approval path.

## Verification and deployment

Focused correction, caption, partial checkout, pricing-import and invoice tests exercise transaction invariants and actual channel payloads. The complete project build, PostgreSQL suite, catalog Python checks, mobile/desktop synthetic browser review and deployed release verification are recorded in the completion receipt. No real customer messages are sent by verification.

Before activation: fresh private database/config backup, exact source/artifact verification, sufficient disk space and current-release checks. The indicative import has its own product snapshot, row preservation checks and audit replay. Older code can ignore the additive metadata column if an application rollback is needed; do not restore an old database over newer customer activity.

Tracked in [issue #32](https://github.com/sagomedia/agent-native-whatsapp-bot/issues/32); prior research is in [issue #31](https://github.com/sagomedia/agent-native-whatsapp-bot/issues/31).

Manufacturer references used as anchors include [Asian Paints Tractor Emulsion](https://www.asianpaints.com/products/paints-and-textures/interior-walls/plain-finishes/tractor-emulsion.html), [Apcolite Enamel](https://www.asianpaints.com/products/wood-and-metals/metal-enamels/apcolite-premium-gloss-enamel.html), and the [Taparia price list](https://tapariatools.tapariatools.com/public/frontend/images/pricelist.pdf). A cited manufacturer price is a reference, not this shop's final selling price.
