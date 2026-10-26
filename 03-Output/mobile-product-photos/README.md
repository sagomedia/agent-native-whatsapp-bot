# Mobile product photos: 10 MB selection and bounded storage

Tracks [issue #81](https://github.com/sagomedia/agent-native-whatsapp-bot/issues/81). Baseline is the deployed audit source bd86e1d / release preview-92455e2561bb, with its documentation checkpoint 2d21b12. Main still lacks the deployed changes; preserve that baseline.

## Findings and research

The Products screen rejected anything above 2 MiB and trusted the file picker's MIME label. The server also rejected more than 16 MP before resizing. This explains possible size/MIME/high-resolution failures, but the original failing Redmi file has not been supplied, so its exact failure remains unconfirmed.

A 10 MiB (10,485,760-byte) selection limit is a practical product-photo policy, not a promise to accept every camera mode. [Samsung documents a default 12.5 MP output even for a 200 MP sensor](https://semiconductor.samsung.com/technologies/image-sensor/ultra-high-resolution/). [Xiaomi supports HEIF](https://www.mi.com/ph/support/article/KA-36390/), which is not interchangeable with JPEG bytes. [Apple documents ProRAW around 25 MB at 12 MP and 75 MB at 48 MP](https://support.apple.com/en-us/119916). RAW/HEIF originals therefore need a clear export-to-JPG instruction rather than a misleading size-only error. The decoder handles ordinary supported photos up to 64 MP / 16384 pixels per side; full-resolution modes above that are explicitly rejected.

The browser uses [Canvas JPEG quality controls](https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/toBlob) and [oriented ImageBitmap decoding](https://developer.mozilla.org/en-US/docs/Web/API/Window/createImageBitmap), with an ordinary image decoder fallback. Quality settings are encoder controls, not guaranteed perceptual percentages or fixed output byte ratios.

## Implementation

One helper is shared by ordinary Add/Edit product, the advanced editor and batch import. It inspects actual JPG/PNG/WebP signatures, reads source dimensions before decoding where available, respects EXIF rotation, reduces decode size on compatible browsers, preserves proportions and never crops or upscales. Transparent backgrounds become white. Encoding begins at 0.84 JPEG quality, decreases only when needed, and reduces dimensions if quality alone cannot meet 500 KiB. The longest saved side is at most 1280 px. Object URLs, bitmaps and canvases are released after processing. HEIF/RAW, corrupt files, oversized files and unreadable downloads have distinct recovery guidance.

Photos are optimized on the phone before transfer; originals are not uploaded by these screens. Only small bytes reach the existing 2 MiB API envelope. The server independently enforces catalog JPEG masters <=500 KiB and previews <=16/40/120 KiB at 128/256/640 px. Customer handwriting/voice/image policies retain their current limits. Source inspection/review history and MCP upload contracts are retained; no historical images are deleted or destructively recompressed. New dashboard review source copies contain the already optimized photo. The ordinary product-add path stores one normalized photo and shared previews, with no uploaded original persisted.

Optimization blocks save/suggestion actions while processing. Failed/repeated selections preserve current facts and existing/previously selected photos. Stale selections cannot replace a different form's photo. Catalog processing errors return actionable 400 responses. Owner CSP permits local blob images for decoding/previews, while script/connect policies and owner authentication are unchanged. Import instructions now advertise the actual 10 MiB selection limit.

## Storage for 3,000 products

Decimal GB below, binary KiB for configured caps:

| Image data | Calculation | Total |
|---|---|---:|
| Uploaded originals, if kept | 3,000 × 10 MB | About 30 GB — avoided |
| Maximum active master + previews | 3,000 × (500 + 16 + 40 + 120) KiB | 2.077 GB |
| Above plus two optimized review/source copies per product | 3,000 × (676 + 1,000) KiB | 5.149 GB |
| Local 12-photo sample, master + previews | Mean 55,164 bytes × 3,000 | 0.165 GB (illustrative) |

The actual VPS reports 31.46 GB disk capacity and 10.47 GB available at inspection. Its 301 existing masters total 19.95 MB (about 66 KB each); database size is about 284 MB. [Aggregate measurements and bounds](evidence/capacity.json), [local catalog sample](evidence/catalog-sample.json). The 2.077 GB bound covers one photo per product and its previews, not the entire database. WAL, index/row overhead, replacements, source/review history, multiple photos, customer voice/media, application releases and backups require additional space. One full backup duplicates retained image data approximately once. Unbounded history/backup growth is not solved by photo compression; no retention deletion was performed.

## Verification

All 1,001 PostgreSQL integration tests pass, zero skipped/failed/cancelled (189.9 seconds), including the existing 3,000-product coverage. Typecheck/production build and all four Python catalog checks pass. The synthetic timeout-decoder fixture was updated to emit bounded valid preview bytes; timeout and child-termination assertions remain intact.

Real Chromium checks cover a 48 MP image, a roughly 10.3 MB PNG (459 KB output), incorrect/empty Android MIME labels, portrait rotation, transparency, corrupt/empty/oversized images, pixel guards and the older decoder fallback. Both phone form paths accepted a roughly 10.2 MB image, transmitted <500 KiB, saved a real synthetic product and reopened its stored image. Failed selection preserved the photo and typed name; choosing the same file again worked. Batch import also loaded its local preview under owner CSP, optimized and saved a product. Database assertions verify stored master/preview bounds and that an invalid replacement leaves the prior image/version intact.

[Browser results](evidence/browser-results.json), [phone editor](evidence/phone-product.png). Synthetic previews send no WhatsApp, AI or payment calls. The exact Redmi file/device remains an owner acceptance check. Deployment proof will be recorded after activation.

## Deployment

Release `preview-2a58e8b0d292`, source `52c52c7935a0a563a0d8b35c12ab11010304dd52`, is active and ready with zero automatic restarts. Exact artifact/process identity verified; schema remains 50. All 342 products, 301 existing photos and their bytes, 325 proposals/298 assets, 21 OAuth grants, catalog revision/product hash, 22 orders and 876 messages are preserved. Environment is byte-identical and 0600. The private uncompressed custom-format database backup passed restore-list validation; previous release remains available. Compiled VPS processing produced a 40,091-byte master and previews of 1,767 /4,342 /14,929 bytes without any database writes or messages. Exact proof: [DEPLOYMENT.json](DEPLOYMENT.json). [PR #82](https://github.com/sagomedia/agent-native-whatsapp-bot/pull/82). Actual original Redmi file/device acceptance remains open in issue #81.
