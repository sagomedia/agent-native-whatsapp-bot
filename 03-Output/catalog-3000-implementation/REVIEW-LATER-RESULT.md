# Catalog published for later review

All **296 remaining live drafts** were published into Products with review pending. The shop now has **336 active products and zero remaining drafts**. The database contained 296 drafts when this request began; the requested 1,200 was not its actual live count. A disposable test separately promoted 1,200 drafts successfully.

Open [Products](https://shopbot-preview.sagoautomation.tech/owner?view=catalog). Use **Search filters → Needs attention → Pending review** to review later. Product pages remain bounded to 25 rows; all 336 products were traversed across 14 pages. Private source reference photos are available inside the selected product.

## Data retained

- All 40 previously published products matched their original fingerprints after publication.
- The 296 source drafts retain their original details and provenance. Their state now records publication; original proposal versions were checked before each write.
- All 291 source photo assets were retained. No reference photo was published as an exact customer image by this operation.
- Unknown prices remain `confirm`, and unknown stock remains `null`. Selling units and all five merchant confirmation flags remain unverified for the newly published products.
- Each publication has an owner audit record. Replaying the saved snapshot reported 296 already published, zero new writes and zero conflicts.
- The Pending review filter currently returns 335 products; this may include products that were already pending review before this batch.

## Validation and release

All 614 integration tests and four Python catalog checks passed. PostgreSQL tests covered 296- and 1,200-row publication, conflicts, store isolation and exact retries. The synthetic browser exercise passed with 3,000 products on desktop and 390px mobile, including pending-price labels, private references and First page recovery. Live verification passed 12 representative customer catalog searches, all 336 owner products, private-photo authentication and readiness.

- Code commit: `e23625709b63a9dadc8e4d30fafbd78cfa9a182b`
- Active release: `preview-ea4972f7b4b9`
- Artifact hash: `ece5b83205495856a99335aaaa39011b88a0f142eac2aecfa1523568ae91f306`
- Schema: 36; private environment unchanged.
- [GitHub Project checks passed](https://github.com/sagomedia/agent-native-whatsapp-bot/actions/runs/39040731344).
- [PR #28](https://github.com/sagomedia/agent-native-whatsapp-bot/pull/28), stacked on PR #26; no automatic merge.

## Recovery evidence

Private backups remain on the VPS. The first completed backup was 147,221,438 bytes. The activation backup at `/var/backups/shopbot-migration/review-later-activation-20261017T143318Z` was 315,841,519 bytes with compression disabled and its full archive decoded successfully. The slow compressed deployment attempt was stopped before application activation; its partial archive is explicitly named `.partial`.

The previous immutable release remains available for code rollback. Use current-version owner hide/edit actions to reconcile individual products. Do not restore an old database over newer customer activity.
