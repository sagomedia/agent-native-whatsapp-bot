# Merchant preparation kit

These are review documents, not runtime import files. No prices, stock or catalog rows were changed by creating this kit.

1. Read `../013-catalog-storage-and-language-guide.md`.
2. Open `catalog-review.json`; each of the 30 demo SKUs has an untouched demo reference and a blank `merchantRecord`.
3. Fill the shop-verified name, brand, family, dimensions, selling unit and integer price in paise. Keep unknown stock or pack conversions unknown.
4. Add English/Tamil/Tanglish names and customer aliases. Check the existing photo against actual stock; record source/evidence and unresolved issues.
5. Review the Tamil and Tanglish wording in `reply-copy-review.json`, including localized unit names before production.
6. Use `product-template.json` for additional variants. Keep one SKU per sellable size/brand/pack variant.

The runtime has no authenticated merchant importer or full language renderer yet. Implement validation, reviewed updates and version invalidation before importing this data. Do not modify historical order snapshots when changing catalog data.
