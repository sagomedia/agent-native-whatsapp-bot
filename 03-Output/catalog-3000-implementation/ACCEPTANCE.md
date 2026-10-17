# Catalog 3,000 implementation — acceptance checklist

This checklist records reproducible local gates and the separate evidence still needed for a real pilot. A command or fixture passing is not evidence that a 3,000-item merchant catalog, real Tamil voice, payment capture, or live WhatsApp is ready. Proposed targets in the plan and evaluation matrix remain proposals until root confirms the measured result and acceptance threshold.

Root verified the following local results on 17 October 2026. Evidence logs are retained under `/home/gk-pc/shopbot-catalog-review/catalog-3000-implementation/`. The local observations below are followed by the completed target-host release and draft-intake results in `DEPLOYMENT-RESULT.md`; merchant approval and real-device acceptance remain separate.

## Automated local gates

Run from the repository root in a disposable checkout and with `DATABASE_URL` pointed at a disposable local PostgreSQL database. The fixture tests create and drop isolated schemas; never point them at a merchant or production database.

```sh
cd 02-Build/shopbot-ai
node --version
npm ci
npm run build
node --import tsx --test tests/catalog-scale-identity.test.ts
node --import tsx --test tests/stock-reservations.test.ts tests/checkout-demo.test.ts tests/payments.test.ts tests/customer-ordering.test.ts
npm run test:integration
python3 -m unittest discover -s scripts -p 'test_catalog_cleanup.py'
```

The retrieval fixture checks exact-name/SKU ordering amid 150 synthetic shared-alias distractors, duplicate-name ambiguity, explicit-filter constraints, equivalent litre spellings, and misleading pack aliases. This is a bounded fixture; it does not by itself establish retrieval quality or latency across a real 3,000-product catalog. The transaction fixtures exercise isolated test records for stock holds and idempotency, checkout/quote behavior, and synthetic payment evidence. The payment test adapter is synthetic and is not registered as a real provider.

Observed results:

| Gate | Result / evidence (root to fill) |
|---|---|
| Source revision and date | 17 October 2026; stacked implementation over `a6cafe4`; final source/artifact linkage is recorded by the clean-checkout release manifest. |
| Build | PASS — `npm run build`; `build-final.log`. |
| Focused retrieval fixture | PASS — included in the full suite; additional synthetic 13/300/3,000 evaluator results in `retrieval-evaluation.json`. |
| Focused transaction fixtures | PASS — stock, checkout, payment, ordering and concurrency regressions included in the full suite. Synthetic/offline evidence only. |
| Full integration suite | PASS — 602 tests, 0 failures, 209.4 seconds; `full-tests-final.log`. Two first-run test expectations were corrected for the additive intake schema and paginated family choices; focused rerun 34/34 and final full run pass. |
| Catalog preparation checks | PASS — 4 Python tests; `python-final.log`. |
| Owner browser rehearsal | PASS — 3,000 products + drafts, largest product page 25; desktop/390px layout and dirty/stale/response-race checks; `browser-scale.log`, screenshots inspected. |
| Local restore | PASS — actual dump/restore, 25 table snapshots, reported schema 36; `restore-final.json`. See capacity/release notes for exact populated/empty-table scope. |
| VPS storage, backup, and restore preflight | PASS — disk/root filesystem expanded to 30 GiB; ready cloud snapshot and private database backups retained. Actual dump restored on target host; 40 retained table snapshots unchanged after migration; previous executable ready on schema 36 and clean shutdown. Channels/providers disabled during compatibility test. |
| Required schema migrations on the intended host | PASS — live schema 36, verified artifact provenance and HTTP readiness. Existing 39-product checksum unchanged; owner authentication required; environment hash unchanged. |

For a fuller catalog evaluation, use one versioned gold set at 13, 300, and 3,000 products and retain per-family results and failure categories. Do not convert the focused fixtures or synthetic distractors into a broad accuracy claim. The 98% candidate-recall and sub-500 ms local p95 figures in the plan are proposed gates, not measured results or confirmed targets.

## Release artifact and restore rehearsal

After the source has been reviewed and committed in a clean checkout, build the release manifest:

```sh
cd 02-Build/shopbot-ai
npm run release:manifest
```

This rebuilds the app, requires a clean Git checkout, and writes `dist/release-manifest.json`. Record the emitted source commit and artifact hash in root-confirmed release evidence. A manifest proves source/artifact linkage; it does not prove deployment or pilot acceptance.

The optional local restore rehearsal requires `DATABASE_URL` to name a disposable database on `localhost` or `127.0.0.1`, and `SHOPBOT_RESTORE_CONTAINER` to name an explicitly disposable Docker container (for example `shopbot-local-test`). Set those variables privately, then run:

```sh
npm run release:restore-rehearsal -- /tmp/catalog-3000-restore.json
```

Review the generated file and confirm its reported database version against the actual migration version before accepting it. This local command uses temporary databases in the named disposable container. The separate completed target-host restore and previous-executable check are recorded in `DEPLOYMENT-RESULT.md`.

## Rollback and transaction preservation

A catalog rollback must be scoped to the affected catalog package, batch, or revision and preserve all committed customer and merchant transactions created after that catalog release. Never restore a whole pre-release database snapshot over live traffic: that can erase later orders, payment evidence, stock movements, messages, and audit records. If there is no tested revision-scoped recovery path, pause the catalog rollout and repair forward; do not claim rollback readiness.

The existing `02-Build/shopbot-ai/deploy/native/rollback.sh` switches services and explicitly retains the new preview files and database. It is not a catalog-data rollback or a database-schema downgrade. Record the tested code/catalog recovery paths separately:

- Code rollback procedure and schema compatibility: local prior pickup SQL and actual previous executable pass against schema 36; target-host restored data matches. No live rollback was required.
- Catalog-revision rollback/recovery procedure: version-checked forward repair and draft rejection/retry documented in `CAPACITY-AND-RELEASE.md`; automatic revision-wide rollback deferred.
- Proof that subsequent committed transactions remain intact: transaction regression suite passes; no automatic revision rollback or live rollback was performed.

## Human and live-service gates — pending

These are separate from automated retrieval and transaction fixture results:

- **Tamil/Tanglish voice:** evaluate consented recordings from real speakers, with human review of transcript, quantities, variants, and retained list rows. Text fixtures, generated speech, and transcript replay do not establish acoustic accuracy. `[pending evidence]`
- **Merchant facts:** have the merchant confirm actual sellable variants, names, units, prices, stock policy/counts, and exact product photos. Draft/demo/synthetic facts are not approval. `[pending merchant sign-off]`
- **Bank capture:** choose and configure the real provider/account, complete provider sandbox verification, and verify a real capture through signed provider evidence before claiming live payment acceptance. The synthetic HMAC/payment fixtures do not perform bank capture. `[pending provider/account and capture evidence]`
- **Live WhatsApp:** verify delivery and replies on the authorized pilot number and a real phone, with fresh conversations and human review. Simulator and HTTP fixture tests do not prove live WhatsApp connectivity or delivery. `[pending live evidence]`
- **Target-host release:** storage expansion, private backup/restore, schema migration, executable compatibility and activation checks completed. The remaining gates above concern merchant facts and real services; see `DEPLOYMENT-RESULT.md`.

## Source paths

- Plan and proposed gates: `/home/gk-pc/shopbot-catalog-review/catalog-3000-plan/PLAN.md` and `EVALUATION-MATRIX.md`.
- Package commands: `02-Build/shopbot-ai/package.json`.
- Retrieval behavior and fixture: `02-Build/shopbot-ai/apps/server/src/services/catalog-discovery.ts`, `02-Build/shopbot-ai/tests/catalog-scale-identity.test.ts`.
- Transaction fixtures: `02-Build/shopbot-ai/tests/stock-reservations.test.ts`, `checkout-demo.test.ts`, `payments.test.ts`, and `customer-ordering.test.ts`.
- Release manifest and restore rehearsal: `02-Build/shopbot-ai/scripts/release-manifest.ts`, `apps/server/src/services/release-manifest.ts`, and `scripts/rehearse-restore.ts`.
- Existing release and rollback guidance: `02-Build/shopbot-ai/deploy/native/RELEASE-CHECKS.md` and `deploy/native/rollback.sh`.
- Prior retrieval and release context: `03-Output/catalog-retrieval-scale/IMPLEMENTATION.md`, `03-Output/034-testable-release-handoff.md`, and `03-Output/033-release-completion-tracker.md`.
