# Dynamic visual discovery — approved 3 November 2026

The owner approved repairing the confirmed carousel/button-layout and alias-family failures, and requested inventory-driven visual narrowing for large result sets. The agent must choose useful distinctions from the current catalog and customer context; do not encode paint-specific brand/pack/tier order or add product-keyword rules. Keep replies short, use native bold sparingly, and use real visual choice cards instead of paragraphs of options.

## Accepted behavior

- Real current inventory supplies candidate facet keys/values/counts, prices and example photographs. The agent selects a short question and a useful narrowing strategy over those available facts. Examples include brand, pack size, finish, length, other specifications or actual price bands; do not invent quality tiers.
- Reuse a validated agent strategy across taps while it still fits the remaining inventory, avoiding another inference call for every button. Reassess when no valid useful planned distinction remains. Fixed channel limits, IDs, catalog revisions, count/measurement separation, selling basis, arithmetic and consent remain deterministic.
- Group selection narrows only. Preserve the full shopping list and requested counts. A pack-size choice is not a purchase count; a photo used to illustrate a group is labelled as an example. Product selection, product approval and order submission remain separate.
- Support nine visual facet choices plus continuation, further refinement, a compact real-product carousel when the result set fits, and ordered multiple carousels for lists. Preserve all legitimate controls and delivery-before-approval guards.
- The reported mixed confirmed/unconfirmed/unresolved cart must render valid button layouts. Diagnose renderer failures by actual error; do not call every error an oversized list or tell the customer to delete products.
- Explicit observed product selections must not be excluded by inferred families from bad broad aliases. Continue verifying actual identity and customer dimensions, never fill cards with unrelated products.

## Implementation plan

1. Repair the confirmed display/retrieval faults and add hardware/unfamiliar-catalog regressions, plus retained local-state offline verification.
2. Extend bounded discovery facts with useful facet coverage and actual price bands. Introduce a validated semantic narrowing strategy; retain compatible agent choices across refinements and validate exact current displayed actions.
3. Render short localized questions and big visual facet values, real example photos, counts and honest fallbacks. Keep known attributes out of repeated questions and retain purchase quantities during all narrowing.
4. Verify 100+ matching products through several levels, diverse non-paint specifications, many values/continuation, stale/forged taps, missing metadata/photos, mixed carts and multi-part approval. Run local build, integration and Python checks before publication; keep issue #88 open for real phone acceptance.

Continue the open review branch/PR #91. Preserve private keys, local/VPS databases and cumulative inference limits. No retained owner audio replay, autonomous customer send or VPS application deployment. Temporarily restore WhatsApp to the VPS while editing; restart the separate local session only after verification. Raw local evidence stays private/ignored.

## Implemented behavior and evidence

The grounding contract now supports an agent-authored `narrowing` strategy over observed attributes, a compact selection of up to ten observed SKUs, or `browseAll` for real matches without useful distinguishing metadata. Modes cannot be combined to hide a sampled SKU limit inside a broad strategy. Remaining facet values/counts revalidate each step. A completed/non-varying attribute disappears; an exhausted strategy offers the actual remaining detail chooser. No fixed semantic facet priority or extra inference per tap is used.

Facet pages contain nine values plus continuation. The chosen page gets real example products from the full matched scope, including later brands outside the 120-candidate sample. Positive known prices form disjoint ranges only with verified/common selling units. Price bands do not invent quality tiers. Metadata-poor results page through actual products beyond the sample. Group examples never select an item or modify purchase count.

Mixed confirmed/unconfirmed/unlisted review cards retain their real item-approval and edit controls with uniform native button counts. Typed renderer failures persist their actual cause, invalidate undelivered consent and offer a version-bound read-only saved-list action. The recovery action is bound after consent has been cleared, and cannot approve or submit. Mutation acknowledgements are shorter and do not report an unrelated line changed merely because its display name was normalized.

Offline retained-state verification (private raw evidence outside Git) reproduced all three reported layouts with the new source: nine cards and eight cards twice, all using two buttons per card, all rendering as native carousel payloads. The retained explicit pipe search now returns all three verified SKU choices instead of zero. No recording was replayed, no customer message was sent, and the local source conversation was queried in a read-only transaction.

Synthetic tests verify brand-first and pack-first strategies over the same 144-product inventory; every stage retains the requested count and an unrelated cart row. They also cover all 203 products without metadata, nine-value continuation, a late brand example beyond the sample, actual price filtering, unsupported strategy keys, forged/stale clicks, dimensions versus count, uniform mixed controls and an actual mocked WhatsApp recovery tap. The five-item phone transcript was reviewed and updated only for the shorter questions, group labels and buttons; final order/submission behavior remains asserted.

## Acceptance still required

Local validation: all **1,137** tests in the complete isolated UTF-8 PostgreSQL suite passed. The subsequent bounded-facet context guard passed **60/60** relevant retrieval/grounding/journey tests, including its new constant-metadata regression. The complete mocked WhatsApp transport/recovery file passed **12/12**, the production build/typecheck passed, and Python catalog/routing checks passed **4 + 6**. Private local preflight confirmed 343 products, one allowed test recipient, the separate local dashboard address and the unchanged cumulative WhatsApp allowance. No external inference call or customer send was used for this stage's verification.

- [ ] Owner tests the current local build on WhatsApp: add an item to an existing list, remove/change by voice, choose visual groups, continue pages and inspect the complete list.
- [ ] Owner verifies actual Gemini question quality on noisy Tamil speech and the actual shop metadata. Controlled model replies prove runtime behavior, not live speech accuracy.
- [ ] Owner checks native phone photos, captions, bold formatting, taps, delivery and separate submission consent. Keep issue #88 open until these checks are recorded.

The local inventory remains a snapshot. Missing or inaccurate merchant metadata can limit useful distinctions; no new catalog aliases, credentials, prices or customer carts were rewritten for this implementation.
