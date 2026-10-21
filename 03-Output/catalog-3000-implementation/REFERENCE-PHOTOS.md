# Reference photos for the review-later demo

The initial review-later publication deliberately left every imported product image empty. The owner reported that this made the expanded catalog unsuitable for visual WhatsApp testing. This follow-up connects the supplied normalized catalog photos as labelled reference images, while merchant photo verification remains pending.

The live diagnosis found 336 active products, 33 existing images, 297 imported products with no published images, and 291 retained source assets. Six source images were explicitly held for contradictory specifications or garbled technical lettering; those remain excluded.

## Behavior

- Public reference images use `/catalog-images/reference/<uuid>.jpg`; their original source files remain private.
- Product data identifies reference images, and WhatsApp cards and the owner dashboard show a short reference label. Ordinary exact photos keep their existing behavior.
- Media loading requires the correct namespace, WhatsApp hostname, active product and shop. Owner-authenticated thumbnails can also show hidden products.
- The operation uses only normalized photo assets whose original checksum matches the registered intake manifest. It never promotes a later unrelated/private upload.
- Existing photos are not overwritten. Known exclusions remain held. Publication changes the image path and product version, and resets photo verification to false; other product facts remain intact.
- Preview snapshots check product/source versions and hashes. Each successful publication is audited. Exact replay does not overwrite later owner edits.

## Operator command

Set database/store/actor configuration privately. Take a fresh private backup, then preview and apply the specific imported batch:

```sh
node dist/scripts/publish-catalog-reference-photos.js --batch=reviewed-300-pass2-20261017 --snapshot=/private/path/reference-photos.json
node dist/scripts/publish-catalog-reference-photos.js --batch=reviewed-300-pass2-20261017 --snapshot=/private/path/reference-photos.json --apply --owner-authorized
```

This operation is not exposed through customer or inventory MCP tools. The existing exact-photo verification path remains available for later owner review.
