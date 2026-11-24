# Contributing to ShopBot

Use a local-disk checkout and one focused change branch from current `main`. Preserve unfinished edits before switching branches. Track bugs, accepted scope and owner/device acceptance in the relevant GitHub issue. Include the implementation commit, checks and remaining acceptance work in its pull request. Preserve the ancestry of any superseded branches and the existing checkpoint tags.

From the repository root, install the locked dependencies with Node 22.12+ within 22.x and `npm ci`. Run the [local checks](LOCAL-DEVELOPMENT.md#verify-a-source-change) before publication. Keep fixtures synthetic and runtime profiles, private media, customer records and generated artifacts outside Git. Run integration tests only on a disposable UTF-8 PostgreSQL test database.

Verify the remote commit and hosted [project checks](.github/workflows/project-checks.yml) before merging. Record actual phone, merchant or payment acceptance separately from code checks. A merge publishes source. The VPS stages checked builds from `main`. Activate an approved build with the manual **Deploy to VPS** workflow and use the [VPS runbook](deploy/native/README.md) for changes to the database, dependencies, service unit, or private configuration.
