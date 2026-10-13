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

Tests create temporary schemas and remove them when done. GitHub Actions supplies its own disposable PostgreSQL service. AI tests use mocked providers; live evaluation is a separate explicitly enabled activity described in `NATIVE-AI.md`.

## Local configuration and data

Create `.env` from `.env.example` and keep it untracked. Do not commit credentials, customer uploads, runtime databases, dependencies or generated build files. Use synthetic fixtures for new tests. The catalog's `owner-only/` data is demo/reference material and must remain outside customer-facing output.

Git history preserves code and documents. Database and media-volume backups are separate tasks; switching a branch does not restore runtime data or restart a running app.
