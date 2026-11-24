# Catalog, backup and pilot checks

For the connected service, artifact checks, staging and activation use the [VPS runbook](README.md).

## Catalog import

The [100-product source package](../../tests/fixtures/catalog-100-corrected/README.md) contains unverified catalog material. Source prices need merchant approval and some photographs illustrate a family. CAT100-002 has conflicting 20 mm and 25 mm measurements.

Validate the supplied package with `npm run catalog:stage -- /absolute/package/path`. To stage approved inputs in a specific store, privately configure `DATABASE_URL`, `SHOPBOT_CATALOG_STORE_ID` and `SHOPBOT_CATALOG_ACTOR`, then add `--apply`. Stable package/item IDs deduplicate retries. Preserve original evidence and seller-approved selling units, stock, prices and photo provenance. For the normal owner-facing direct import flow and existing-product edits, read [catalog import](../../docs/CATALOG-CHAT.md).

## Backup and pilot evidence

`npm run release:restore-rehearsal -- /tmp/evidence.json` requires `DATABASE_URL` pointing to a disposable local PostgreSQL instance and `SHOPBOT_RESTORE_CONTAINER` naming its explicitly disposable ShopBot Docker container. Alternatively set `SHOPBOT_RESTORE_PG_BIN` to local PostgreSQL binaries with the loopback test database credentials; this also creates only uniquely named disposable test databases. It creates two temporary databases, restores an actual custom-format dump, reruns migrations and compares retained data hashes. It does not touch merchant databases. This complements the populated v26→v31 migration test; it does not replace a production restoration and executable rollback rehearsal.

After deployment, use fresh conversations on the authorized pilot number. Cover the five-item order, pump/cutter, missing paint count, read-only price interruption, keep/clear, owner acceptance/ready/collection, noisy voice, handwritten and printed lists, and correction recovery. Real speakers, source photos, Tamil terminology and merchant facts need human review. Mocks and TTS cannot establish that accuracy.

`npm run pilot:evidence -- /private/reviews.json /private/evidence.json` collects a read-only report for a verified compiled release. A review file contains `releaseFingerprint`, `reviewer` and `cases`. Each case supplies `conversationId`, `requestId`, one named scenario, `outcome`, `merchantVerified`, `tamilReviewed`, `expectedLinesHash`, a relative `phoneScreenshot`, `realSourceMediaHashes` and `notes`. Keep this file private. The collector checks request/merchant/catalog binding, completed pickup, signed delivery records for every outbound part, matching release fingerprints, media hashes and unresolved inference holds. It requires 20 distinct completed requests spanning every scenario. Failed/incomplete cases remain failures. Human review fields are explicit attestations, not automated linguistic validation.

For consent, every part of a multipart review needs delivered/read evidence. An accepted API send alone is insufficient. A trusted tap can prove receipt of a single-part reply; typed/voice approval still requires delivery evidence. Unknown sends are held for reconciliation.
