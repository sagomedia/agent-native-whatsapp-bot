# Catalog quality replay

This bot is a Tamil/Tanglish visual shopping experience. Identification fixes must preserve actual photos, rupee prices, quantities, explicit product selection and final consent. Missing products remain requests for the shop to check; a missing catalog result does not establish physical stock availability.

## Reproduce against a catalog snapshot

Export only the store's `products` and `catalog_nodes` arrays into JSON. Keep snapshots outside Git. Do not export customer messages, credentials, orders or OAuth grants for this replay.

```sh
DATABASE_URL=postgres://repair_admin@127.0.0.1:55971/shopbot_repair_test \
node --import tsx scripts/evaluate-shop-catalog.ts /absolute/path/catalog-snapshot.json /absolute/path/report.json
```

The runner refuses remote databases and database names not ending `_test`. It imports into a new private schema and removes that schema afterwards. No provider or WhatsApp calls are made. It records 26 raw searches and four real runtime flows with fixed mock canonical interpretations; those are not a measure of fresh speech/model accuracy. No production catalog facts or aliases are changed.

## Regressions covered

- Adding a 12-inch measure to `spirit level` must retain exact catalog alias evidence even when the owner saved the item under a general-purpose family. A conflicting 24-inch measure or explicit family/specification filter must still reject it.
- Empty results must not ask customers to select an unsupported brand/colour. Actual candidates with unknown attributes can still require useful compound clarification.
- An empty product group must not become an empty photo selector. Preserve a truthful visual request card, quantity and localized explanation of the shop-check step.
- Existing product carousels, multi-line removal, material corrections and consent remain independently tested.

## Remaining quality work

Raw colloquial queries such as `nalli` and `PVC pipe ottura solvent` require evidence-based intent clarification. Do not rewrite ambiguous `oli` into chisel, nalli into nipple, or night latches into an aluminium bolt merely to produce a match. Distinguish generic product types from exact aliases so one alias-linked item does not hide other valid variants. Reconcile duplicate taxonomy families before making broad catalog changes. Stock, selling units and photo provenance need merchant verification.

Recent production evidence also showed successful transcription followed by an invalid understanding contract. Diagnose a safely retained failing response or controlled real-model reproduction before relaxing validation. Offline retrieval success cannot establish that this voice failure is fixed.
