# shop-catalog-100-corrected

Corrected package for the Tamil-first WhatsApp ordering app catalog (100 hardware SKUs).
Derived from the read-only package `~/workspace/shop-catalog-100/` — the original is untouched.

## What was fixed

- **Specification keys: 101 camelCase keys -> snake_case** across 99 records (e.g. `pipeClass` -> `pipe_class`, `jointType` -> `joint_type`). **0 collisions**: no two original keys normalized to the same snake_case key, so nothing was merged or renamed.
- **10L paint exchange (CAT100-053):** the weakest/duplicate record (Dulux Promise 4L — interior-wall-paint had three 4L emulsions) was replaced with a real documented 10L variant. The data fixer first assigned Asian Paints Tractor Emulsion 10L (manufacturer page showed a 10L pack, MRP Rs.2230); the image worker then sourced a permitted exact photo of **Dulux Promise Interior Emulsion 10L (White)** — the record was reconciled to the documented photo identity (same brand as the exchanged-out 4L, cleaner exchange). Official AkzoNobel 10L pack art (1500px, downscaled to 1280px); Dulux PDS states packs in 1/4/10/20 L; reference quote Build Jahaan Rs.2020/piece incl. taxes (reference only). Pack art shows a tinted shade — white variant uses identical artwork. Total stays at 100 records; family unchanged. Asian Paints facts preserved in change-log.
- **Priority photo defects resolved:** CAT100-061 (TIMCO-marked brush -> exact Johnson 2" brush photo, sticker verified), CAT100-086 (TrustBasket package -> exact Agriansh 15m hose photo with logo), CAT100-099 (identity corrected 8210 -> **8210V** per photo stamp + 3M spec sheets; plain 8210 is valveless — existing IndiaMART quote flagged as possible mismatch), CAT100-016 bonus (1-pint photo -> exact 1/2-pint label photo). CAT100-002: 180mm family photo replaced with Finolex-branded white UPVC pipe photo, but stays **family_only** — no permitted source ties a Finolex photo to the 20mm/6m/Sch-80 variant, and a size-mapping conflict surfaced: supplier documents "20mm = 3/4 inch" while Finolex's own ASTM Sch-80 brochure lists 20mm as 1/2 inch (25mm = 3/4 inch). Owner must verify actual stock before sale.
- **ownerConfirmation:** all 100 records now have exactly `{price, stock, sellingUnit, productIdentity, photo}`, all `false` (no owner evidence exists).
- **fieldsSupported:** 41 factSource entries converted from string to array; all arrays now.
- **missingFields:** filled per SKU (was all empty): owner-pending price/stock/unit for all 100, photo problems for 62 records, no price reference for 4 SKUs, quote-basis conflicts for 8 SKUs, spec/model substitutions and legibility issues.
- **Quote basis:** all `packSize` values are explicit strings. Clarified mismatches between quote basis and proposed shop unit: CAT100-032 (pack of 10 sets), CAT100-033 (pack of 10, not per piece), CAT100-049 (pack of 2, not per piece), CAT100-080 (per hinge, not per pair), CAT100-081 (pack of 5, not per pair), CAT100-086 (per piece = 1 roll; Flipkart-vs-Toolsvilla price conflict preserved, never averaged), CAT100-087 (Rs.97 per METRE, not per 30m roll), CAT100-074/075 (wholesale per-kg rate with 200kg MOQ). Paint quotes keep their trade packaging unit (bucket/tin) with a note that the shop unit is `can`.
- **catalog-map.json:** carried over; every product's familyId resolves to a family with a real department parent (plumbing, tools, paints, fasteners, garden, safety). No changes.
- **exceptions.json:** rewritten to corrected reality (84 items) — each unresolved item with what is needed to resolve it.
- **owner-review.csv:** regenerated; shop price/stock cells blank everywhere, internet quotes shown as reference notes only.
- **Full photo re-verification:** all 100 photos re-inspected against their records (the original 38 "exact" labels were not taken as proof). Final: **44 exact / 51 family_only / 5 unconfirmed** — 7 upgrades to exact (016, 029, 053, 061, 067, 086, 099), 1 downgrade (050: photo shows 600mm graduations vs 150mm SKU). Specific mismatches logged and kept non-exact (024 D.N-brand 12m tape vs Crown 10m; 025 white tape vs yellow; 052 3.6L label vs 4L; 074 75mm nails vs 40mm; 042 180mm wheel vs 100mm; 008 straight fitting vs tee; 081 chrome vs brass; 093 green vs ivory) — no silent substitutions. 5 photos replaced (002, 016, 053, 061, 086); pre-edit originals in `originals/`; hashes/ops/checks in `image-edits.json`. A cosmetic edit never upgrades variantMatch. Caveat: sources below 800px were NOT upscaled (no invented detail); a few manufacturer thumbnails keep non-ideal backgrounds to protect product evidence. Every image keeps the small "sago automation" corner watermark.
- **change-log.json:** 17 entries — audit-basis header, snake_case summary (0 collisions), 10L exchange + reconciliation, 4 priority SKU resolutions, variant-match re-verification, ownerConfirmation/fieldsSupported/missingFields repairs, quote-basis clarifications, CSV regeneration.

## Known remaining gaps

- **CAT100-002:** photo stays family_only; size-mapping conflict (20mm = 3/4" per supplier vs 1/2" per Finolex brochure) — owner must verify stock.
- **Photos:** 51 family_only + 5 unconfirmed photos — exact variant pack shots not verified; importer must prevent non-exact images from being shown as approved exact SKU photos.
- **Tamil/Tanglish names:** transliteration-based, not auditorily verified (flagged in reviewNotes; not invented).
- **No owner evidence:** all prices, stock, and selling units are unconfirmed — owner review is the gate before any import.

## Import and verification

The application integration test stages the 100 records into a temporary test schema, verifies the proposal count and checks that CAT100-002 retains its size-mapping issue. Run the integration suite with `npm run test:local` from the app directory. Fractional-inch measurements have their own parser and retrieval regressions.

The published product identities, prices, stock, selling units and photo provenance still require merchant review. In this package, zero price and unknown stock represent unconfirmed values. Family-only and unconfirmed photos require separate provenance review before they can serve as exact product photos.
