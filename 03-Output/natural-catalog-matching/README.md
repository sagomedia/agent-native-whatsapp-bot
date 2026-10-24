# Natural customer catalog matching

Tracks #73; based on the deployed source carried by open PR #72.

## Behavior

- Customer purchase, price and discovery flows use the same catalog resolver. Price requests remain read-only and retain constraints on recheck.
- Product wording is normalized separately from the preserved customer query. Grounded face-mask wording, Tamil/Tanglish paint and colour names, structured brand/colour/material evidence, and legacy/new paint-family discovery are supported.
- Exact numeric specifications, rating and physical-unit checks remain enforced. Teflon/PTFE/PVC product-type words and N95 ratings are not mistaken for freely substitutable brand names.
- Customer flows can show three labelled alternatives when exact requested brand/colour/pack attributes have no match. Alternatives require explicit selection; differences appear on the actual visual cards. Existing explicit litre/kg pack-choice safeguards remain separate.
- Requests awaiting shop checking have an explicit label and retain the existing partial submission path. A read-only lookup never claims it saved a draft line.
- Clarification progress is stored per unresolved item, resets when meaningful details change, and is unaffected by price checks, browsing, unrelated items, delivery retries and clear-list actions. After two unsuccessful replies, the existing shop-request review action is promoted; it does not automatically submit or take over the conversation.
- Search diagnostics include bounded rejection samples, separated by category, brand, specification, measurement and identity. Counts from samples are diagnostic evidence, not full-catalog exclusion totals.

## Compatibility

No migration, merchant catalog rewrite, new model, inference stage or budget change. Additive optional search/result/memory/draft fields remain compatible with old persisted JSON. Existing confirmations still validate current product facts. Deployment increments only the store's discovery revision to invalidate older assistant search memories; orders and media are preserved.

## Verification

Synthetic fixture coverage: 60 query wordings/negative cases, eight multi-turn conversations, typed attribute propagation, rating protection, explicit alternative selection and real partial request submission. Existing voice, confirmation, quantity, price, catalog-scale and public-admission suites are also required.

Tests use a disposable local PostgreSQL cluster and mocked AI/WhatsApp providers. Live replay is read-only and makes no AI calls. See deployment evidence for final run counts and the before/after live search results.

## Owner/device acceptance still required

From WhatsApp, send a face-mask request, refine it to N95 and give a count. Ask for Asian Paints white 4 L, then a colour absent from the catalog; verify the difference label. Correct one line and submit an unresolved request using the existing shop-check flow. Record completion in #73; a successful synthetic run is not device acceptance.
