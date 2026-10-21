# Contributing

The application lives in `02-Build/shopbot-ai/`. Preserve original inputs under `01-Input/`; place useful verification evidence under `03-Output/`. The build's `STATUS.md` records implemented behavior and remaining milestones.

## Branches and commits

Start from an up-to-date `main` and use one branch per change:

```bash
git switch main
git pull --ff-only
git switch -c codex/describe-the-change
```

Make focused commits describing the behavior changed. Review `git diff` and `git diff --cached` before committing. Push the branch and open a pull request against `main`; describe the outcome, validation and known limitations. Merge after the checks pass. `checkpoint/*` tags preserve earlier verified versions; do not move or delete them as part of routine development.

Keep one branch per unfinished change. After merging, start the next change from updated `main`; do not accumulate new stages on branches whose pull requests have already merged. Delete a completed branch only after its commits are preserved in `main` and any unpublished local work has been saved. Close superseded stacked pull requests with a link to the consolidation that preserves their work. GitHub's automatic deletion of merged branches is enabled; remote branch deletion does not remove a local checkout or its uncommitted edits.

## Tracking and publication

Track bugs, requested features and remaining acceptance work in GitHub Issues, and link the relevant issue from the pull request. Keep owner/device acceptance issues open until the actual checks are recorded; merging code does not complete a real-device or payment test.

For every major implementation stage, publish a focused commit and record its commit link, relevant validation and remaining work in the linked GitHub issue. Keep the issue checklist current. Commit the accepted scope before broad implementation so later changes can be traced to the owner's decision.

Before reporting work as published, confirm that the remote branch contains the intended commit and provide the pull request URL and its check status. A local commit or recovery bundle is not publication. If a push fails, report the exact failure and which checkpoint remains local so the blocker can be resolved promptly. Keep unfinished changes out of the published checkpoint.

The current GitHub login has repository and workflow access. If authorization later expires or a workflow push is rejected for a missing scope, use `gh auth refresh --hostname github.com --scopes workflow`, complete browser authorization and verify `gh auth status` before retrying. Keep active development on a normal local-disk Git checkout; the historical SMB workspace can be unavailable and its Git metadata pointer is specific to one computer.

## Checks

Use Node 22.12+ within the 22.x release line. From `02-Build/shopbot-ai/`, run:

```bash
npm ci
npm run build
python3 -m unittest discover -s scripts -p 'test_catalog_cleanup.py'
```

The integration suite also needs PostgreSQL and FFmpeg. With the local Compose database running:

```bash
docker compose run --rm app npm run test:integration
```

Use a UTF-8 PostgreSQL database (`SHOW server_encoding` must return `UTF8`). A `SQL_ASCII` test database can split Tamil text in bounded history queries and produce misleading conversation failures. For a new disposable database, create it with `TEMPLATE template0 ENCODING 'UTF8'`; keep the existing database intact.

Tests create temporary schemas and remove them when done. The GitHub Actions workflow in `.github/workflows/project-checks.yml` supplies its own disposable PostgreSQL service. Run the checks locally before publishing; then verify the hosted workflow before merging. AI tests use mocked providers; live evaluation is a separate explicitly enabled activity described in `NATIVE-AI.md`.

## Local configuration and data

Create `.env` from `.env.example` and keep it untracked. Do not commit credentials, customer uploads, runtime databases, dependencies or generated build files. Use synthetic fixtures for new tests. The catalog's `owner-only/` data is demo/reference material and must remain outside customer-facing output.

Git history preserves code and documents. Database and media-volume backups are separate tasks; switching a branch does not restore runtime data or restart a running app.
