# Resumable draft intake

The v2 intake stages arbitrary product counts, including 3,000, with one product transaction at a time and registration chunks of 1–100 rows. It never publishes, grants merchant confirmations, updates live product facts or moves inventory. The original strict 100-product importer and `catalog:stage` command remain compatible.

## Input contract

A package contains these three UTF-8 JSON files and optional local `images/` raster files. Each JSON file is limited to 64 MiB; split larger sources into separate stable batch IDs. Product image bytes are loaded one at a time, limited to 2 MiB, checked against MIME, and decoded outside the store lock. No URLs are fetched.

`products.json`:

```json
{
  "schemaVersion": 2,
  "currency": "INR",
  "products": [{
    "sourceSku": "SOURCE-001",
    "details": {
      "name": "Example cutting plier 8 inch",
      "familyId": "source-pliers",
      "unit": "piece",
      "quantityStep": 1,
      "pricePaise": 0,
      "priceStatus": "confirm",
      "stock": null
    },
    "image": {"path": "images/plier.jpg", "mimeType": "image/jpeg", "matchKind": "family_only"},
    "provenance": {"source": "Reviewed supplier source, owner approval pending", "issues": ["Confirm exact variant and selling basis"]}
  }]
}
```

`details` uses the existing partial proposal contract; `name` is required. Do not supply active/verified/verification flags. Source price/stock must be missing or unknown (`0`, `confirm`, `null`); internet prices and stock counts are rejected. Omitted price/stock are normalized to unknown. An image is optional; its identity is explicitly `exact`, `family_only`, or `unconfirmed`.

`canonical-map.json`:

```json
{
  "schemaVersion": 1,
  "skus": [{"sourceSku": "SOURCE-001", "canonicalSku": "SHOP-PLIER-8"}],
  "families": [{"sourceFamilyId": "source-pliers", "canonicalFamilyId": "cutting-pliers"}],
  "exclusions": []
}
```

Every source SKU needs exactly one mapping or exclusion with a reason. Every mapped product needs an explicit family mapping. Duplicate canonical targets are rejected: resolve and exclude a duplicate source explicitly. An existing live SKU requires `baseVersion` in its mapping. Stale versions and unresolved drafts from other batch/items become conflicts. New batch IDs do not bypass canonical conflicts. No automatic fuzzy merge exists.

`catalog-map.json`:

```json
{
  "schemaVersion": 1,
  "nodes": [
    {"id": "tools", "parentId": null, "kind": "department", "label": "Tools", "localNames": {}, "aliases": []},
    {"id": "cutting-pliers", "parentId": "tools", "kind": "family", "label": "Cutting pliers", "localNames": {}, "aliases": []}
  ]
}
```

Taxonomy IDs are canonical, stable and shop scoped. Existing nodes must match, including their labels and aliases; intake does not rename existing merchant taxonomy. The source research repair must return reviewed canonical maps before real datasets are combined. This implementation does not change source datasets.

## Commands

Run from `02-Build/shopbot-ai`. Set an explicit `DATABASE_URL`, `SHOPBOT_CATALOG_STORE_ID` and `SHOPBOT_CATALOG_ACTOR` in the environment for staging. Do not point an unreviewed package at production.

```bash
# Read-only structural/image-header validation, mapping and existing-SKU/version diff
node --import tsx scripts/import-bulk-catalog.ts /absolute/package --batch=source-revision-1

# File validation without a database; output clearly says databaseChecked=false
node --import tsx scripts/import-bulk-catalog.ts /absolute/package --batch=source-revision-1 --offline

# Stage at most 50 non-completed rows, then resume with identical files and batch ID
node --import tsx scripts/import-bulk-catalog.ts /absolute/package --batch=source-revision-1 --apply --max-items=50
node --import tsx scripts/import-bulk-catalog.ts /absolute/package --batch=source-revision-1 --apply

# Bounded status, then use nextCursor as --after for the following page
node --import tsx scripts/import-bulk-catalog.ts /absolute/package --batch=source-revision-1 --status
```

Dry-run reports new/update/conflict/excluded rows, source effective unique count, expected total catalog unique count after eventual approval, held image identity and pending merchant facts. The expected total is null when database checks are unavailable or conflicts remain. It validates file paths, image headers and hashes; full raster decoding happens during staging and can fail per row. Missing/malformed images are explicit conflicts, never silently discarded. A package without an image remains a draft needing an owner photo decision.

Migration 36 adds durable batches/items and a pending canonical draft index. Each batch records the exact source hash and a manifest with source details/provenance, mappings, image hashes and exclusion reasons. Every source row gets durable pending/staged/failed/excluded/conflict status. Each item transaction atomically commits its proposal, optional original/normalized asset, status and audit; a failed item leaves no half-staged photo. Retries skip staged rows and retry failed/conflict rows. Restarts during item registration fill the remaining rows. Status is keyset paginated (default 100, maximum 200) and joins current proposal version/state, preserving merchant draft edits.

The same batch ID accepts only identical package bytes and image content. Corrected source files need a new reviewed batch ID; outstanding drafts from the old source must be resolved deliberately. This prevents accidental replacement of owner edits. Review/publish/reject stays with existing owner proposal actions, including exact-image and merchant-confirmation checks.

Existing SKU edits carry a base version. Verified merchant identity, selling basis, price status/value and stock facts are copied from the current locked product into its proposed edit. Imported facts cannot downgrade them; no merchant verification is granted to a draft. Live facts remain unchanged until a separate owner action.

## Validation and limits

Verified in the isolated PostgreSQL database on 17 October 2026: `npm run typecheck` passes; the six bulk integration cases pass, and all four existing proposal cases pass, including the original 100-product/photo import and replay. The bulk run is synthetic local evidence, not production throughput or merchant acceptance.

```bash
# DATABASE_URL must explicitly select an isolated database; each test uses its own schema.
node --import tsx --test --test-concurrency=1 tests/catalog-bulk.test.ts
node --import tsx --test --test-concurrency=1 tests/catalog-proposals.test.ts
```

`tests/catalog-bulk.test.ts` exercises 3,000 rows with bounded interruption/resume/replay, SQL partial failure and atomic retry, current draft version reporting, changed-source rejection, canonical/exclusion/family validation, existing SKU conflicts, verified merchant facts and image original/MIME/path/decoder/identity handling. The legacy 100-product integration remains in `tests/catalog-proposals.test.ts`.

No HTTP filesystem import endpoint, automatic scheduler, bulk publish, production dataset import, capacity assessment or source-catalog repair is included. Staging is sequential to bound decoding, memory and store-lock use. JSON metadata is read once in memory within the file cap. Database storage keeps originals plus normalized assets, so production capacity/backup checks remain a release prerequisite. A header-valid but undecodable photo is reported during apply. A permanently corrected source/photo is a new source revision, not an in-place retry.

## Background decoder budget

Sequential bulk staging allows 30 seconds for each bounded raster decoder subprocess on a small VPS. Other image paths retain the 10-second default. The internal timeout option accepts integer values from 1,000 to 60,000 milliseconds; client product/photo payloads cannot set it. The image size, dimension, protocol, memory, original-byte and transaction limits are unchanged. Timeout rows retain explicit failures and can be retried with the same immutable source package; completed proposals are skipped.
