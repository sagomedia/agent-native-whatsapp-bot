# Capacity and release conditions

## Read-only inspection

`npm run catalog:capacity` requires explicit `DATABASE_URL`, `STORE_ID` and `CAPACITY_PATH`. It does not start the app or run migrations. It reads one shop's product count, retained proposal original/normalized bytes and published photo bytes in a read-only repeatable-read transaction, and reports filesystem space for the explicitly supplied path. Optional positive integers: `CAPACITY_TARGET_PRODUCTS` (default 3000), paired `CAPACITY_SAMPLE_BYTES` / `CAPACITY_SAMPLE_COUNT`, and `CAPACITY_RESERVE_BYTES`.

The projection includes one retained original, one normalized draft photo and one published photo per additional product. It uses observed means where present, a supplied final-photo sample where requested, and an explicit 3x-original fallback where no original sample exists. A 1.25 database overhead envelope, one WAL copy and two backup copies are planning assumptions, not measured physical disk usage. Default reserved headroom is the larger of 2 GiB or 10% of the filesystem. No deduplication savings are assumed. Exit 2 means insufficient space or missing sample; exit 1 means inspection failed. A space-fit result alone does not approve deployment.

Migration 36 adds a nullable SHA-256 hash to published photos. New identical normalized bytes/dimensions reuse one immutable photo within the same shop, under the existing shop write lock. Different shops remain separate. Existing assets are preserved without a bulk backfill; each product still requires its own photo decision. Original proposal bytes/provenance are retained.

## Initial storage blocker and completed expansion — 17 October 2026

Read-only VPS inspection found 308,969,472 bytes available (about 295 MiB) on the 10.3 GB root filesystem, 97% used. PostgreSQL and backup paths share that filesystem. RAM is about 964 MiB, with about 370 MiB available at that observation; swap is already in use. The current service was active. This initial measurement preceded the work described below.

The supplied 300 final images total about 53.2 MiB. At that mean, 3,000 final images alone approach 532 MiB, before originals, normalized copies, PostgreSQL overhead, WAL and backup retention. That initial disk could not support the rollout. The authorized GCP disk and online ext4 root filesystem were expanded from 10 to 30 GiB. The post-expansion check found about 19.15 GiB available; the service stayed active and database/readiness checks passed. A ready cloud snapshot and a fully decoded private database backup were retained. Rerun capacity inspection as retained media and backups grow. Do not delete rollback backups or transaction history to bypass the gate. Increasing worker counts also needs host and provider-quota measurements; defaults remain one per stage.

## Local migration and recovery evidence

The integration suite upgrades reconstructed older schemas and exercises idempotent setup. The updated restore rehearsal uses a real custom `pg_dump` and `pg_restore` inside an explicitly disposable local PostgreSQL container, then runs migrations twice. It compares 25 table snapshots, including intake manifests/row states, proposals/original photos, published-photo hashes, stock ledger, requests, messages and inference holds. The populated fixture proves staged proposal links/resume state, byte/hash preservation, stock movements, unknown inference holds and owner product versions survive. Empty payment/outbox tables establish schema preservation only. The reported version is queried from the restored database rather than hardcoded.

A separate target-host rehearsal restored the actual merchant dump into a temporary database, applied migration 36 twice, and compared 40 retained table snapshots unchanged. Both owner API versions and all 39 current SKU/name searches passed. The actual prior executable started on schema 36 in about 30 seconds and shut down cleanly with provider/channel credentials disabled. The temporary database was removed. This establishes the tested executable compatibility and retained-data restoration scope, not provider recovery or real-device acceptance. The verified runtime is now active; see `DEPLOYMENT-RESULT.md` for release identifiers and the separate catalog import result.

## Release sequence

1. Review the stacked GitHub changes in order: intake/schema, retrieval, owner pages, runtime/release tooling. Preserve their base dependencies.
2. Resolve the returned catalog's variant/selling-basis issues. Assemble a derived v2 package using reviewed canonical SKU/taxonomy mappings and image holds; preserve source folders. Run offline and database dry-runs. Draft readiness is separate from merchant approval.
3. Fix measured storage capacity. Back up on the intended host, verify restore, and check prior-executable compatibility without customer traffic.
4. Deploy code with worker counts at 1/1/1. Stage only the reviewed canary package as drafts; review current merchant facts and exact images before publication.
5. Test real Tamil/Tanglish voice and a fresh WhatsApp order on the authorized pilot number. Verify estimate, order visibility, stock reserve/collect/cancel, follow-up and demo payment wording. QR generation does not establish bank capture.
6. Expand the catalog and traffic separately after the measured gates pass. Synthetic 3,000-row replay is not real-world recognition accuracy.

## Recovery that preserves subsequent transactions

Stop new intake and pause the affected catalog rollout. A staged-only import is recovered by resolving/rejecting its drafts or retrying the identical batch; nothing has been published. A changed source requires a new batch ID. Published corrections must be forward, version-checked owner edits/proposals against the current catalog, preserving newer stock and order snapshots. Never restore a pre-release whole database over live traffic. Code rollback switches the executable while retaining the current database; it does not undo catalog facts. Automatic revision-wide catalog rollback remains deferred until tested against later committed orders/payments/stock movements.

## Completed target intake measurement

After all 297 drafts staged, the read-only report measured 291 retained original/normalized photo pairs (54,866,582 / 19,250,439 logical bytes) and 20,172,386,304 filesystem bytes available. A sample of the 291 normalized images projects 4,750,189,852 additional bytes for 3,000 products plus a 3,146,145,792-byte reserve. Status: projected space available. This is the stated storage planning envelope, not 3,000-product CPU, memory, recognition, restore retention or traffic acceptance. The six currently published products missing photos are excluded from photo-backfill growth and require separate budgeting. See `deployment-result.json` for the exact assumptions and unknowns.
