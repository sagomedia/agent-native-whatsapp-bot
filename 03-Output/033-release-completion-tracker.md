# ShopBot completion tracker

Started 15 October 2026 from `106b533` on `codex/reconciled-counter-flow`.

The user requested completion of the full bot, including online payments and owner MCP, and selected **Codex** as the MCP client. Payment provider/account remains unspecified. The corrected 100-product source was found under `/home/gk-pc/Downloads/temp_files/shop-catalog-100-corrected`; all 100 entries are inactive/unverified, with zero/unconfirmed price and unknown stock. It is input for owner review, not evidence of approved merchant facts.

| Package | Work and completion evidence |
|---|---|
| P0–P2 | Prior local commits and 483 passing checks; exact-count optimization and real Meta rate reconciliation remain explicit pilot checks |
| P3/P5 | Implemented and checked locally: common reply decision, native clarification/error payloads, consistent readiness/active-line selection, incomplete-bill action suppression and retained count/size text |
| P4 | Implemented and checked locally: bounded raw observation retention, envelope/row diagnostics, no partial execution after a rejected contract, supported wire bounds and joint prefix/postfix count attribution |
| P6 | Implemented and checked locally: canonical publication, shared units, per-fact merchant checks, editable unpublished proposals, original photos, explicit hide/reject, selling policy and 100-product intake. Real merchant approval remains pending |
| P7 | 505 integration checks and four Python checks pass; actual disposable dump/restore and repeated v31 migrations preserve retained data. Clean-source build manifest, runtime fingerprint, private release endpoint and delivery-backed consent implemented. Actual hosted CI, target-host restore/rollback and deployment remain pending |
| P8 | Read-only pilot evidence collector implemented. Real text/voice/photo/phone pilot and human acoustic/Tamil/merchant review have not been performed for this release |
| P9 | Official SDK stdio server and protocol client integration pass through draft/photo → merchant publication → customer search. Installed Codex accepts the prepared configuration. The real owner client connection is not configured; SSH access to the target host is currently rejected |
| P10 | Disabled payment foundation and synthetic signature/idempotency/settlement/refund/expiry tests pass. Provider selection, real adapter, checkout integration and sandbox/account tests remain pending. Public-number recipient/account policy is not changed |

This tracker is updated from verified outcomes. It does not treat code completion, mocked tests, deployed source and real merchant acceptance as interchangeable percentages. Existing requests, unknown-cost holds, catalog versions and original media must survive upgrades and rollback. The separate shared checkout is preserved; Git commands name this worktree explicitly.

## Verified local evidence, 15 October 2026

- `033-release-evidence/integration-summary.txt`: 505 passed, zero failed/skipped; includes the actual stdio handshake and 100-row intake/replay test.
- `033-release-evidence/restore-rehearsal.json`: 11 retained tables matched after actual `pg_dump`/`pg_restore` and repeated migrations. Prior pickup SQL reads remain compatible; a previous executable rollback on the target host is still a separate check.
- `033-release-evidence/source-catalog-manifest.json`: hashes of the supplied source package, including all 100 supplied image originals. “Original” means the exact uploaded/package bytes, not a claim that earlier source editing never occurred.
- Browser rehearsal uses a disposable loopback database. Name-only draft, separate merchant confirmations, synthetic product publication/search, preservation of the published price during a draft edit, and 390 px layout were checked. It makes no AI, Meta or payment call.
- `02-Build/shopbot-ai/deploy/native/RELEASE-CHECKS.md` contains the executable build, catalog, MCP and pilot workflow. Local tests are not a hosted CI result.

## Concrete remaining inputs

The payment provider question remains unanswered; “Codex” answers the MCP client question. Existing local SSH keys were rejected for both known usernames, and no access/key policy was changed. The VM is reported running by the cloud API, but its live release could not be inspected through SSH. All 100 catalog items still need merchant confirmation; the source explicitly contains unknown prices/stock, family photos and variant conflicts. No product fact, real customer message, payment, public-number policy, GitHub publication or deployment was changed in this phase.
