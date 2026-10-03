# KSMC normalized demo catalog

Prepared 2 October 2026 from the preserved source in workspace `01-Input/ksmc-demo/source`. There are 30 supplied products, not 50. All 30 complete source records and images are accounted for.

## Files

- `catalog.json`: normalized customer-facing demo product data, IDs H01–H30, English/Tamil search aliases, sizes, proposed selling units, integer-paise prices and review flags.
- `images/H01.jpg` … `images/H30.jpg`: original JPEG bytes with stable SKU filenames; these remain generated demo placeholders.
- `image-map.json`: original filenames, normalized paths and hashes.
- `review-issues.json`: outstanding provenance, brand, MRP, stock-unit and demo-billing conflicts.
- `owner-only/financials-and-originals.json`: cost/margin, complete original records and conflicting billing/details evidence.
- `owner-only/source-manifest.json`: SHA-256/size for every preserved source file.

No original file was edited. The raw invalid JSON remains preserved; the new catalog is valid JSON. No source instructions to upload/publish/import were executed. The data is not yet loaded into the running database or simulator.

## Normalization choices

The matching structured JSON/detail `price` field is retained as `pricePaise`. Its tax treatment is unresolved; do not treat it as an approved final payable amount, add tax automatically, or select one conflicting MRP. Cost/margin are absent from the customer catalog. All specification/quality claims remain synthetic and unverified.

H02 has Blueguard versus Finolex, H14 Pro-Cut versus TEZZ INOX, and H15 Premium Industrial versus Bosch. Structured demo names/brands are retained with conflict flags. Conflicting brands are excluded from active aliases; neutral Tamil descriptions replace disputed-brand aliases. All original names remain in owner review. This does not establish the real brand.

The details file states stock in `pcs` for every product. H07 bottle, H08 roll, H21 pack, H27 box and H29 pair are proposed demo selling units, not verified conversions. Their normalized stock is unknown. H27 explicitly contains 100 screws per box; do not interpret the source 200 pcs as 200 boxes or invent a conversion. Other products retain synthetic piece counts. Actual merchant units/availability still need confirmation.

There are 11 discrepancies between details-file and billing-file MRP. All 30 illustrated tax-added bills exceed the billing file's stated demo MRP; that simulation is preserved owner-only rather than chosen as customer pricing. This is a data consistency finding, not a determination of real tax or commercial rules.

`productionReady` remains false globally and on every product. This output can support a labeled mock importer once implemented. Production import requires approved identities/specifications, selling/stock units, prices/tax policy, availability and real photos.

“Owner-only” is a file separation convention, not runtime access control. Future API/static routes must whitelist `catalog.json` and `images/` and never serve this whole directory, original source, financials or review evidence. Private fields must also stay outside customer model context.

## Reproduce and verify

From the application folder:

```sh
python3 scripts/prepare-ksmc-catalog.py
python3 -m unittest discover -s scripts -p test_catalog_cleanup.py -v
```

The cleanup uses Python's standard library and makes no model/API calls. It accepts the observed malformed ending only after recovering all 30 expected complete records; missing IDs, duplicate IDs, incomplete objects, unsupported syntax, mismatched primary details, invalid amounts or unmatched images fail validation.
