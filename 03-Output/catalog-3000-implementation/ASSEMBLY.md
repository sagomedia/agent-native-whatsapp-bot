# Offline reviewed-catalog assembly

`scripts/assemble-reviewed-catalog.ts` converts the three reviewed source batches and their canonical SKU, taxonomy, and image-exclusion maps into a new v2 bulk-catalog package. It reads local files only. It does not connect to a database, call a provider, stage proposals, or publish catalog rows.

Run from `/home/gk-pc/whatsapp-bot-finish/02-Build/shopbot-ai`. The output directory must not exist, and its parent must already exist outside the source handoff:

```bash
npx tsx scripts/assemble-reviewed-catalog.ts \
  --source-root /home/gk-pc/Downloads/mega_folder \
  --out /home/gk-pc/whatsapp-bot-finish/03-Output/catalog-3000-implementation/assembled-v2 \
  --split-overrides /home/gk-pc/whatsapp-bot-finish/03-Output/catalog-3000-implementation/split-overrides.json
```

The split file is optional. When used, it is a JSON array and each entry must identify one `confirmed_duplicate`, provide a new canonical SKU unused anywhere in the source map, and state why the item is being separated. For the two currently requested conservative splits, the file can contain:

```json
[
  {
    "batchId": "03-approved-3",
    "sourceSku": "KSMC-0011",
    "canonicalSku": "CANON-KSMC-0011",
    "reason": "BR White shade is unresolved; preserve a separate draft until the shade is confirmed."
  },
  {
    "batchId": "03-approved-3",
    "sourceSku": "KSMC-0015",
    "canonicalSku": "CANON-KSMC-0015",
    "reason": "WallCare line is unresolved; preserve a separate draft until the exact product line is confirmed."
  }
]
```

The source canonical map is never edited. Every product row receives a deterministic batch-namespaced source key and remains in `products.json`. Only confirmed duplicates without a split override become explicit package exclusions, each linked to its nonduplicate representative. `needs_review` items remain separate mapped rows with their uncertainty in provenance. Canonical taxonomy comes from `canonicalCategories`; family aliases use only `genericAliases`.

Price, stock, and merchant verification remain unconfirmed: output drafts carry `pricePaise: 0`, `priceStatus: "confirm"`, `stock: null`, and no active or verified flags. `excludeImage` holds omit the image and remain in provenance. Other supported local raster files are MIME-checked, limited to 2 MiB, content-deduplicated, and tagged `unconfirmed`; no URLs are fetched. Missing or unsupported local images are omitted with an issue while the product row remains.

Review `assembly-audit.json` alongside the three v2 JSON files. It records each source batch/SKU, generated namespaced IDs, source-row hash, original and effective decision, canonical target, exclusions, image disposition, and SHA-256 hashes for the source maps and batch JSON files. The assembler validates the finished directory with `readBulkCatalogPackage` before renaming its temporary directory into the requested absent output path.

Automated checks are local fixtures only:

```bash
npm run typecheck
node --import tsx --test tests/reviewed-catalog-assembly.test.ts
```

These checks cover deterministic source accounting, duplicate exclusions, unresolved rows, explicit split overrides, image holds and byte deduplication, immutable inputs, overwrite/path refusal, unconfirmed commercial defaults, malformed maps, and acceptance by the v2 package reader. They do **not** establish real Tamil voice understanding, validate merchant facts, confirm shop inventory, or test delivery through live WhatsApp. Those remain separate evidence-gathering steps before any customer-facing activation.

The production build also emits `dist/scripts/import-bulk-catalog.js` and `dist/scripts/catalog-capacity.js`; `deploy/native/package-release.py` refuses to package a build missing either file. After `npm run build`, the compiled CLI smoke tests run these emitted JavaScript entrypoints directly with a minimal environment. The bulk smoke test uses `--offline` and a disposable one-row package; the capacity smoke test supplies no settings and checks its sanitized fail-closed response. Neither test requires a database or makes network calls.

## Returned 300-row handoff

The pass-2 source produced 297 draft targets and 3 explicit duplicate exclusions, accounting for all 300 rows. Seventeen source review decisions plus two conservative splits remain marked for review. Six held photos are omitted; all other photo matches remain unconfirmed. The versioned `split-overrides.json` preserves the two unresolved shade/product-line pairs separately without editing the source map.

`reviewed-catalog-result.json` records the checked source hashes and offline result. It is preparation evidence, not merchant approval or a claim that the products are live. Database conflict checking and draft staging are separate steps; staging never publishes products.
