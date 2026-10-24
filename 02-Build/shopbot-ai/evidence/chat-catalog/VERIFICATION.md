Historical verification of the earlier isolated catalog commit. Its migration number was subsequently reconciled to 47 on the newer customer-flow source. Current combined verification is documented in `evidence/owner-workflows/VERIFICATION.md`. The counts below are historical, not the current build.

# Chat catalog verification

Implementation isolated from source `f4ec94967e8aa6f27a04e90552e605d5becc1a60`, which includes the latest remote MCP registration and protocol repairs. The original source checkout remained clean at that revision during implementation.

- Unchanged baseline: **904/904** tests passed after building the required compiled CLI/dashboard artifacts.
- Focused MCP/catalog verification: **24/24** passed, including existing remote compatibility and proposal tests.
- New chat workflow tests cover incomplete drafts, seller corrections, canonical operation replay, exact/cleaned/marketing provenance, original byte retention, publication replay, stale fields/images/inventory/product versions, expired reviews, another actor/store, explicitly granted publication and revocation.
- The official MCP client exercised prepare → host-file handoff → image previews → review → commit, with zero provider attempts. Existing-product image previews were also verified for edit review without another upload. The downloader supplied a controlled actual JPEG; this is not a real external ChatGPT file-transfer test.
- Restricted SQL-role compatibility verifies context/draft/review operations without granting UPDATE on published products. The stdio installer grants only the additional draft-service tables and retains its original password and published-product restrictions.
- Populated v26 → current and additive v45 → v46 upgrades preserve original records, support repeated migration, and reject version-number collisions. The historical downgrade fixture was extended for the new additive tables and current version.
- Build/typecheck and the reusable skill validator passed. Installer Python syntax was checked without running the installer against any deployed database.
- Synthetic mobile browser verification passed under the owner CSP: publication checkbox initially unchecked, explicit opt-in, bound OAuth redirect/token, and disconnect revocation. No real external account or inventory was changed.
- Tests use a separate UTF-8 PostgreSQL 17 cluster on local port **54339**. WhatsApp delivery and paid/server-side model inference are not configured for this verification.

Final complete regression: **915/915 passed**, including all eleven new chat workflow/SQL-role tests. Exported commit identity is recorded in the delivery handoff. Schema version **46** must be checked again against the actual integration source. No deployment, live grant upgrade or live catalog publication was performed.
