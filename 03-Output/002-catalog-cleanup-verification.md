# KSMC catalog cleanup verification

2 October 2026. Local demo preparation only.

- 34 input files copied into the workspace and compared byte-for-byte with Downloads. Originals unchanged.
- Recovered 30 complete records H01–H30 from malformed source JSON; no missing or invented products.
- Created valid catalog JSON and 30 SKU-to-JPEG mappings; normalized images retain original bytes.
- Prices/costs converted to integer paise using exact decimal arithmetic.
- Customer catalog omits cost/margin/original financial evidence; separate owner review data retains it.
- Three brand conflicts are flagged; disputed brand aliases are excluded.
- Five stock unit ambiguities remain unknown; no box/pair/roll conversion guessed.
- No upload, database import, paid API call, customer message or simulator change occurred.

## Outstanding source discrepancies

| Type | Count |
| --- | ---: |
| invalid_source_json | 1 |
| misleading_product_count | 1 |
| synthetic_data | 1 |
| mrp_conflict | 11 |
| billing_total_exceeds_demo_mrp | 30 |
| brand_conflict | 3 |
| stock_unit_unresolved | 5 |

## Conflicting MRP values

| SKU | Details MRP (paise) | Billing MRP (paise) |
| --- | ---: | ---: |
| H01 | 26900 | 27000 |
| H05 | 2700 | 2800 |
| H07 | 9300 | 9400 |
| H10 | 10400 | 10500 |
| H12 | 1900 | 2000 |
| H15 | 6000 | 6100 |
| H21 | 6000 | 6100 |
| H22 | 7100 | 7200 |
| H26 | 4900 | 5000 |
| H27 | 10400 | 10500 |
| H29 | 9300 | 9400 |

## Checks

Four focused stdlib tests passed: reject partial/duplicate/invalid records; keep uncertain units and disputed brands explicit; omit owner financials and retain exact image identity; validate exact money and reject fractions of a paise/non-finite amounts.

Reproduction: `python3 -m unittest discover -s 02-Build/shopbot-ai/scripts -p test_catalog_cleanup.py -v`.

Source preservation hashes are in `02-Build/shopbot-ai/resources/catalog/ksmc-demo/owner-only/source-manifest.json`.

Next: implement a mock-only importer/search adapter with whitelisted public assets, metadata persistence and tenant-scoped aliases. Keep review flags visible. Then build the natural ordering workflow.
