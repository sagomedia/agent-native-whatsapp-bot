# Release and pilot checks

The current release adds owner review drafts, Codex MCP over stdio, retained interpretation evidence, native clarifications and delivery-backed consent. Payment services are a disabled foundation. There is no real payment adapter, checkout route or provider account until the merchant chooses the provider. The synthetic payment adapter exists only in tests.

## Build and identify the release

From this app directory, use Node 22.23.4, PostgreSQL 17 and FFmpeg. Run `npm ci`, `npm run build`, `npm run test:integration` against a disposable local database, and `python3 -m unittest discover -s scripts -p 'test_catalog_cleanup.py'`.

Commit the reviewed source, then run `npm run release:manifest`. This command requires a clean checkout, rebuilds it, checks that HEAD and the checkout stayed unchanged, and hashes the compiled server, dashboard, public resources and dependency lock. `npm run build` alone does not mint release proof.

Run the compiled server with `SHOPBOT_REQUIRE_VERIFIED_RELEASE=true`. Startup refuses missing/mismatched artifacts. The authenticated `/api/owner/release` reports commit/tree, artifact digest, model, prompt/schema versions and active feature flags. Runtime messages carry the artifact fingerprint. Source/tsx previews remain explicitly unverified. This is a content/provenance check, not a cryptographic signature from an independent build service.

Package using `deploy/native/package-release.py`; it verifies the build manifest before accepting a Node archive or an existing runtime. Upgrade the existing service with `upgrade.sh`, never the historical first-install script. Preserve `/etc/shopbot-vps.env`, the recipient allowlist, budgets and unknown sends. Do not enable customer sends, change accounts or widen access merely to make a test pass.

## Merchant catalog

The supplied source is preserved in `01-Input/catalog-100-corrected` at repository level. All 100 records are unverified drafts. No source price is a merchant selling price, and source images include family references. CAT100-002 has an unresolved 20 mm/25 mm nominal-size conflict. The importer retains research and exception warnings; it does not resolve this by an invented conversion.

Validate with `npm run catalog:stage -- /absolute/package/path`. Apply only to the chosen shop with `DATABASE_URL`, `SHOPBOT_CATALOG_STORE_ID` and `SHOPBOT_CATALOG_ACTOR` set privately, then add `--apply`. The deployed equivalent is `node dist/apps/server/src/db/catalog-intake.js /private/package/path --apply`. It reports per-row failures and replays stable package/item IDs without duplicating rows. The package digest covers product JSON, hierarchy, research, exceptions and every supplied image. Source hierarchy IDs are namespaced to avoid overwriting existing categories.

Use Products → Review unpublished drafts. Name-only/photo-only drafts may lack unit/price/stock. Original and normalized images remain private. Changing a published product creates a proposal; the active product remains unchanged until approval. Publication checks identity, exact photo or explicit absence, selling basis, price status and stock status separately. A family reference cannot be selected as an exact product image. Rejected drafts retain their evidence. Hiding a product is an explicit versioned action.

The recorded inventory policy is **manual confirmation**. Orders are requests; the shop confirms availability before acceptance. The bot does not reserve/decrement inventory or promise automatic stock allocation. Integer stock remains the existing database contract. Fractional cutting and continuous length require explicit selling policy and valid increments; they do not imply fractional stock accounting.

## Codex MCP

The pinned official SDK serves stdio and authenticated remote HTTP, accepts legacy/current MCP negotiation, and fixes store/actor from trusted process configuration or validated OAuth grants. Complete products publish directly; new-product draft tools are retired and older records remain recoverable. Catalog read has twelve tools and edit has fifteen, including capability discovery, context, media validation and in-chat review. Publication is disabled by default; an explicit owner OAuth checkbox or trusted stdio flag enables catalog_commit, catalog_add_product and catalog_import_item (twenty catalog tools, including stock adjustment and archive/restore). Existing grants retain their original permissions. The owner-read opt-in adds thirteen private dashboard tools; order-write adds seven guarded order tools. See MCP-OWNER-WORKFLOWS.md for all forty tools, privacy boundaries and explicit consent. The dedicated SQL draft role remains unable to publish; enabling a flag alone does not add database privileges. Re-run the draft-role installer after migration 47 to grant only the additional review/receipt/image tables. There are no SQL, shell, payment or generic URL-fetch tools. Bounded host file handoff accepts supported OpenAI file URLs. Writes reuse the store lock, audit and proposal/product services. See CATALOG-CHAT.md for the conversation, scope and migration contract.

Review `codex-mcp.example.toml`, replace its absolute paths, and create a private mode-600 environment file using `shopbot-mcp.env.example`. Do not commit secrets. The example is disabled until configured. With a remote database on the VPS, prefer an existing authorized SSH stdio command that starts the compiled server there; the database credential can remain on the server. Do not expose an unauthenticated HTTP MCP endpoint. Remote HTTP OAuth is configured separately from this stdio file.

The local Codex CLI accepted this configuration shape. The user's real Codex connection and remote access must still be validated. The 2 MB photo limit applies before base64 encoding; large batches should use the intake CLI rather than placing all photo bytes in a model prompt.

## Backup and pilot evidence

`npm run release:restore-rehearsal -- /tmp/evidence.json` requires `DATABASE_URL` pointing to a disposable local PostgreSQL instance and `SHOPBOT_RESTORE_CONTAINER` naming its explicitly disposable ShopBot Docker container. Alternatively set `SHOPBOT_RESTORE_PG_BIN` to local PostgreSQL binaries with the loopback test database credentials; this also creates only uniquely named disposable test databases. It creates two temporary databases, restores an actual custom-format dump, reruns migrations and compares retained data hashes. It does not touch merchant databases. This complements the populated v26→v31 migration test; it does not replace a production restoration and executable rollback rehearsal.

After deployment, use fresh conversations on the authorized pilot number. Cover the five-item order, pump/cutter, missing paint count, read-only price interruption, keep/clear, owner acceptance/ready/collection, noisy voice, handwritten and printed lists, and correction recovery. Real speakers, source photos, Tamil terminology and merchant facts need human review. Mocks and TTS cannot establish that accuracy.

`npm run pilot:evidence -- /private/reviews.json /private/evidence.json` collects a read-only report for a verified compiled release. A review file contains `releaseFingerprint`, `reviewer` and `cases`. Each case supplies `conversationId`, `requestId`, one named scenario, `outcome`, `merchantVerified`, `tamilReviewed`, `expectedLinesHash`, a relative `phoneScreenshot`, `realSourceMediaHashes` and `notes`. Keep this file private. The collector checks request/merchant/catalog binding, completed pickup, signed delivery records for every outbound part, matching release fingerprints, media hashes and unresolved inference holds. It requires 20 distinct completed requests spanning every scenario. Failed/incomplete cases remain failures. Human review fields are explicit attestations, not automated linguistic validation.

For consent, every part of a multipart review needs delivered/read evidence. An accepted API send alone is insufficient. A trusted tap can prove receipt of a single-part reply; typed/voice approval still requires delivery evidence. Unknown sends are held for reconciliation.

## Pending external gates

- Restore existing SSH access to the target VM and verify its actual running release; current local keys are rejected. No authentication changes were made.
- Confirm merchant prices, stock policy, selling basis and exact photos for the real pilot catalog; approve Tamil/voice/list-photo results.
- Select the payment provider/account, then implement its official signature, capture, expiry, cancellation and refund adapter and run provider sandbox tests. No API secret should be pasted into chat.
- Connect the real Codex client and validate the staged release on the phone. Hosted CI and public-number/account readiness need actual evidence; local checks do not establish them.
