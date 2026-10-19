# Product editor, palette and image performance

Follow-up to deployed PR #35. User feedback: product editing was not sufficiently redesigned, green/teal palette disliked, images slow, overall efficiency needs attention. User delegated palette choice. This is a plan and source audit; implementation has not started.

## Confirmed findings

- The full product form and five merchant confirmations precede the bottom save buttons. Existing visible-product edits still use publication; ordinary price/count updates need a shorter guarded path.
- OwnerCatalog clears dirty state after saving draft details but before uploading a selected photo. An upload failure can leave unsaved photo state without navigation protection.
- Add-as-new resets product identifiers but can retain the existing proposal identity. The next save can modify the original proposal; publication is then rejected by server safeguards.
- 48 px list thumbnails and 176 px editor photos request the same full normalized JPEG. No image size variants exist. Existing 30 local demo JPEGs have median 159.5 KiB and maximum 508.2 KiB; these measurements do not establish the size of all live imported photos.
- Owner responses use private,no-store. Current image GET ignores the v query parameter; do not make these mutable URLs immutable. Custom images involve product lookup plus photo lookup. Draft previews fetch both normalized and original bytes even when only one is returned. Normalization happens at upload, not on every image GET.
- Conversation history polls every five seconds on other pages and hidden tabs. Global snapshot polling also repeats expensive aggregates. Catalog stays mounted behind a hidden container, so non-catalog views still initialize catalog work.

Source baseline: ea6db8d2d1375e026eff1ac75e7a3023e6fe5501. Main files: OwnerCatalog.tsx, owner-ui.tsx, OwnerDashboard.tsx, owner-verification.ts, OwnerStock.tsx, owner.ts, owner-catalog.ts, catalog-photos.ts and catalog-products.ts.

## Delivery order

### 1. Repair editor correctness

- [ ] Track saved details, pending photo upload and publication independently. Retain navigation/close protection until each intended operation succeeds; preserve failed photo input for retry.
- [ ] Clone using a fresh product/proposal identity and a deliberate staged-photo copy; never modify the original draft.
- [ ] Exercise upload failure/retry, clone from published product and open draft, stale versions and cancelled navigation.

### 2. Improve image delivery and background work

- [ ] Establish cold/warm browser baseline: requests, transferred bytes, first visible thumbnails, selected image, image p50/p95 TTFB, SQL/pool wait and interaction responsiveness on a fixed throttled network.
- [ ] Generate thumbnail/editor variants once at ingest; bounded, resumable backfill for existing photos. Proposed widths 128/256/640, subject to quality/byte review. Preserve original details and explicit full-size inspection. Never infer missing or substitute photos.
- [ ] Use image-content identity plus size in URLs. Keep owner authentication and store scoping; private conditional validation with ETags. Verify actual response headers. Conversation recordings and customer photos retain their separate stricter policies.
- [ ] Fetch only requested preview/original bytes; reduce duplicate lookup work. No request-time unbounded image rendering.
- [ ] Selected editor photo loads immediately; offscreen rows remain lazy; reserve layout dimensions and decode asynchronously where useful.
- [ ] Conversation polling only while the inbox is visible; prevent overlapping refreshes, cancel obsolete reads and back off when idle. Separate lightweight operational counts from expensive historical settings/usage data.
- [ ] Defer catalog and other heavy screens until first use while preserving existing dirty drafts and navigation guards. Measure initial bundles and transfer compression before splitting further.

### 3. Complete Products redesign

- [ ] Inventory first: compact searchable table, stable SKU selection, filters and visible edit action. Preserve search, current page, scroll and selection after save.
- [ ] Dedicated product editor with clear sections: Details; Price & stock; Photos; advanced search/unit/specification controls. Keep all existing capabilities reachable.
- [ ] Sticky footer with Save changes/Save draft, Cancel and explicit publication status. Review actual changed fields before applying to visible products; do not require another screen for every tiny edit.
- [ ] Price quick edit uses the same guarded fact-update semantics as bulk updates, confirms only the affected field and preserves unrelated review flags/visibility. Identity, selling-basis and photo changes retain their own review requirements.
- [ ] Stock shows on hand, reserved and available together. One clear adjustment workflow: restock, sale or corrected physical count. Preserve movement ledger, independent stock version, reservation floor and replay checks.
- [ ] Show affected confirmations alongside relevant fields and a compact needs-review summary. Retain authorized review-later publication; do not silently re-hide existing products.

### 4. Apply the chosen visual system consistently

White surfaces #FFFFFF; cool page #F4F6F8; charcoal text #20252B; secondary text #64748B; blue actions #2563EB; borders #D9E0E8. Green/amber/red are semantic status colors only. Define shared tokens for all owner pages, tables, forms, dialogs and focus states. Test contrast, disabled states and 390 px layout. No changes to customer WhatsApp invoice/QR styling are implied by this owner-dashboard palette.

## Verification and acceptance

- [ ] Save/photo failures preserve work; cloning never changes the source; no silent publication/hiding.
- [ ] Updating a photo appears on next validated fetch; unchanged image bytes are reused. No unauthorized or cross-store cache access.
- [ ] Zero recurring conversation-history requests outside the visible inbox. No overlapping polling under a slow response.
- [ ] Provisional target: >=75% less list-thumbnail transfer than the full-image baseline. Report measured cold/warm timings and bytes rather than claiming a guaranteed speedup. Keep technical product details readable in expanded photos.
- [ ] Desktop/390 px browser checks cover edits, errors, preview, stock, bulk updates and keyboard focus. Existing transaction, quote, inventory and customer-flow tests remain green.
- [ ] Re-measure after changes before attributing remaining slowness to VPS resources. Network/tunnel latency, database saturation and decode overhead remain unmeasured hypotheses.

Ship separate linked changes: correctness repair; image/polling performance; editor/palette UI. Record exact source, checks and deployment for each major release. Related: #17, #29, #34, PR #35. Customer session evidence remains separate from fixture checks.

References: [MDN image element](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/img), [MDN HTTP caching](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Caching).
