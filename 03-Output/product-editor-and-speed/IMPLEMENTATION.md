# Products editor and owner dashboard performance

Tracks issue #36; follows deployed PR #35. White surfaces, charcoal text and blue actions apply only to the owner dashboard. Customer WhatsApp cards, invoice and QR flow retain their existing behavior.

## Owner editing

Products opens as inventory, with Edit product and Update price on each row. Search/filter state and selected SKU are retained. Revision-bound pagination resets after a mutation, avoiding stale cursors.

The editor leads with shop price and on-hand/reserved/available stock. Existing products use the stock movement panel for restock, walk-in sale or corrected counts; a new product can supply its initial physical count. Identity, photo, selling unit and advanced catalog controls remain available. A sticky action bar keeps Cancel, Save draft and explicit publication review visible. Review lists changed fields where the current product baseline is available. Merchant confirmations retain their targeted invalidation rules. Existing review-later publication is preserved.

Photo uploads remain dirty until details and selected photos are durable. Failed uploads can retry without losing the navigation warning. Cloning copies a selected staged photo before resetting to a fresh product/proposal identity, leaving the source unchanged. Explicitly free draft prices reopen as zero.

Quick price uses the existing guarded fact preview/apply service with captured product/inventory versions and selling unit. It requires shop confirmation, previews the result and retains the same chunk token after an uncertain response. Stock, visibility and unrelated verification flags are preserved.

## Images and request work

Migration 39 adds store-scoped, normalized-source-hash JPEG variants at 128/256/640 px plus proposal image hashes. New photos prepare these outside the owner's store write lock. Old images fall back to existing bytes until the bounded backfill completes; requests never transcode. Originals remain unchanged.

The compiled `backfill-catalog-image-variants.js` defaults to read-only preview. Apply requires `--apply --owner-authorized`, an explicit store/database, a maximum 100-source page and a retained `--after` cursor. Failed sources leave the cursor before the failed row. Reruns reuse variants. It writes image previews/hashes, never product facts, publication or inventory. Native packaging requires this executable.

Authenticated image responses validate actual representation ETags after resource/store access checks. Normalized previews use private, no-cache, max-age=0; mutable SKU URLs are not immutable. Raw uploaded originals and customer conversation media retain private no-store. Foreign, missing or unauthorized resources cannot return a cached 304. Preview reads retrieve only the requested representation.

Conversation history polls only in the visible inbox. Completion-based polling, aborts and serialized manual refreshes avoid overlapping reads. Catalog loads on first use and remains mounted afterward to protect edits. Its superseded reads abort and late results are ignored. Lightweight snapshots omit expensive usage/audit/messaging aggregates; Settings requests those explicitly. Message review and catalog bundles load separately.

## Controlled browser comparison

Synthetic 30-product fixture; 1440×1000 viewport; 60 ms latency; 256 KiB/s download and 128 KiB/s upload. Same inventory URL, 23 image requests. Actual transfer includes protocol overhead.

| Measurement | Baseline | Updated |
| --- | ---: | ---: |
| Cold image transfer | 4,257,144 bytes | 51,519 bytes |
| Warm image transfer | 4,257,144 bytes | 12,006 bytes |
| Cold visible thumbnails | 9,251 ms | 3,489 ms |
| Warm visible thumbnails | 7,059 ms | 2,932 ms |
| Unrelated history requests per visit | 4 | 0 |

Cold image transfer decreased 98.8% in this fixture. These are local controlled results, not a live VPS, 3,000-product or real customer benchmark. Warm responses revalidate rather than transferring unchanged bodies. Baseline bundle was about 493 KB uncompressed; catalog and message review are now separate lazy chunks. CDN compression and production network behavior require separate observation.

Browser checks cover 390 px/desktop layouts, inventory-first entry, quick price preview/apply and lost-response replay, preserved stock/visibility, cancel, sticky actions, failed photo warning/retry, fresh cloned proposal, free draft reopening, and absence of catalog/history work on unused views. Transaction/cache/stock regression checks and full CI accompany the PR. Private evidence and release/backup receipts stay outside Git; the PR records final counts and source/artifact identifiers.
