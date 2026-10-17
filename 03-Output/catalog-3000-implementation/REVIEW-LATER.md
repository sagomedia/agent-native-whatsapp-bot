# Publish together; review in Products

The owner explicitly authorized moving all current drafts into active Products and reviewing them afterwards. The live inspection on 17 October found 296 drafts and 40 active products, rather than 1,200 drafts. GitHub issue: https://github.com/sagomedia/agent-native-whatsapp-bot/issues/27.

## Behavior

- The operator previews every current draft in the owner’s shop, then applies the saved ID/version snapshot with explicit owner authorization.
- Newly published products become searchable by the customer bot. All five merchant verification flags remain false; selling units are not falsely verified. Source names, aliases, category, pack details and provenance are retained.
- Unknown prices remain `confirm`; unknown stock remains `null`. A missing price is shown as **Price to confirm**, not ₹0 or free.
- The initial operation kept all source photos private. The owner subsequently requested visible images for the demo; [REFERENCE-PHOTOS.md](REFERENCE-PHOTOS.md) describes the follow-up that publishes eligible normalized copies as labelled reference images while originals and known exclusions remain private.
- Existing products and edit proposals are never overwritten by this bulk operation. Invalid, changed or colliding drafts are reported individually. Successful rows survive an interrupted run; replaying the same snapshot does not duplicate them.
- Each publication creates an owner audit record linked to the snapshot and source. No publication capability is exposed to the inventory MCP or AI tools. The ordinary verified publication path remains strict.

## Reviewing later

Open Products → Filters → Needs attention → **Pending review**. Search by name, Tamil name, product code or brand. Pages remain bounded to 25 products; Next, Previous and First page navigate the entire catalog. Open a product to view its private source reference photos and update the shop facts. Existing hide and versioned edit controls remain available.

## Operator command

Set `DATABASE_URL`, `SHOPBOT_CATALOG_STORE_ID` and `SHOPBOT_CATALOG_ACTOR` privately. Use the compiled release entrypoint; no development runtime is needed.

```sh
node dist/scripts/promote-catalog-review-later.js --snapshot=/private/path/review-later.json
node dist/scripts/promote-catalog-review-later.js --snapshot=/private/path/review-later.json --apply --owner-authorized
```

The preview writes a new mode-0600 file and performs no catalog writes. Take a fresh private database backup before applying. Keep the snapshot, audit records and deployment receipt. Revert individual publications with the existing owner hide action at their current versions; do not restore an old database over newer customer activity.

## Validation

Focused PostgreSQL tests, the integration suite, compiled CLI checks and the bounded 3,000-item synthetic browser exercise are recorded in the deployment receipt after execution. Synthetic browser checks do not claim real-device voice acceptance.
