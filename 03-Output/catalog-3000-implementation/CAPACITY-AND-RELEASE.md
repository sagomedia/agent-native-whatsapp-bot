# Capacity and release conditions

## Read-only inspection

`npm run catalog:capacity` requires explicit `DATABASE_URL`, `STORE_ID` and `CAPACITY_PATH`. It does not start the app or run migrations. It reads one shop's product count, retained proposal original/normalized bytes and published photo bytes in a read-only repeatable-read transaction, and reports filesystem space for the explicitly supplied path. Optional positive integers: `CAPACITY_TARGET_PRODUCTS` (default 3000), paired `CAPACITY_SAMPLE_BYTES` / `CAPACITY_SAMPLE_COUNT`, and `CAPACITY_RESERVE_BYTES`.

The projection includes one retained original, one normalized draft photo and one published photo per additional product. It uses observed means where present, a supplied final-photo sample where requested, and an explicit 3x-original fallback where no original sample exists. A 1.25 database overhead envelope, one WAL copy and two backup copies are planning assumptions, not measured physical disk usage. Default reserved headroom is the larger of 2 GiB or 10% of the filesystem. No deduplication savings are assumed. Exit 2 means insufficient space or missing sample; exit 1 means inspection failed. A space-fit result alone does not approve deployment.

Migration 36 adds a nullable SHA-256 hash to published photos. New identical normalized bytes/dimensions reuse one immutable photo within the same shop, under the existing shop write lock. Different shops remain separate. Existing assets are preserved without a bulk backfill; each product still requires its own photo decision. Original proposal bytes/provenance are retained.

## Measured host blocker — 17 October 2026

Read-only VPS inspection found 308,969,472 bytes available (about 295 MiB) on the 10.3 GB root filesystem, 97% used. PostgreSQL and backup paths share that filesystem. RAM is about 964 MiB, with about 370 MiB available at that observation; swap is already in use. The current service was active. No cleanup, disk resize, import, migration or activation was performed.

The supplied 300 final images total about 53.2 MiB. At that mean, 3,000 final images alone approach 532 MiB, before originals, normalized copies, PostgreSQL overhead, WAL and backup retention. The present disk cannot support this rollout. Provision or expand durable storage, or agree a reviewed cleanup/retention plan, then rerun the inspection against the actual database/WAL/backup volumes. Do not delete rollback backups or transaction history to bypass the gate. Increasing worker counts also needs host and provider-quota measurements; defaults remain one per stage.

## Local migration and recovery evidence

The integration suite upgrades reconstructed older schemas and exercises idempotent setup. The updated restore rehearsal uses a real custom `pg_dump` and `pg_restore` inside an explicitly disposable local PostgreSQL container, then runs migrations twice. It compares 25 table snapshots, including intake manifests/row states, proposals/original photos, published-photo hashes, stock ledger, requests, messages and inference holds. The populated fixture proves staged proposal links/resume state, byte/hash preservation, stock movements, unknown inference holds and owner product versions survive. Empty payment/outbox tables establish schema preservation only. The reported version is queried from the restored database rather than hardcoded.

The rehearsal does not prove target-host backup restoration, provider recovery or running an older executable against the new schema. Migration 36 is additive; prior pickup SQL is exercised locally, but executable rollback must be checked with the actual prior release before activation.

## Release sequence

1. Review the stacked GitHub changes in order: intake/schema, retrieval, owner pages, runtime/release tooling. Preserve their base dependencies.
2. Resolve the returned catalog's variant/selling-basis issues. Assemble a derived v2 package using reviewed canonical SKU/taxonomy mappings and image holds; preserve source folders. Run offline and database dry-runs. Draft readiness is separate from merchant approval.
3. Fix measured storage capacity. Back up on the intended host, verify restore, and check prior-executable compatibility without customer traffic.
4. Deploy code with worker counts at 1/1/1. Stage only the reviewed canary package as drafts; review current merchant facts and exact images before publication.
5. Test real Tamil/Tanglish voice and a fresh WhatsApp order on the authorized pilot number. Verify estimate, order visibility, stock reserve/collect/cancel, follow-up and demo payment wording. QR generation does not establish bank capture.
6. Expand the catalog and traffic separately after the measured gates pass. Synthetic 3,000-row replay is not real-world recognition accuracy.

## Recovery that preserves subsequent transactions

Stop new intake and pause the affected catalog rollout. A staged-only import is recovered by resolving/rejecting its drafts or retrying the identical batch; nothing has been published. A changed source requires a new batch ID. Published corrections must be forward, version-checked owner edits/proposals against the current catalog, preserving newer stock and order snapshots. Never restore a pre-release whole database over live traffic. Code rollback switches the executable while retaining the current database; it does not undo catalog facts. Automatic revision-wide catalog rollback remains deferred until tested against later committed orders/payments/stock movements.
