# Local Git checkpoints and rollback

The project source stays on the shared workspace. SMB does not support the chmod operations required to initialize Git metadata, so `.git` points to `/home/gk-pc/.local/share/shopbot-ai/project-git` on this computer. `git status`, `git log`, branch switching and commits work from the project directory. No GitHub remote or push has been configured.

- `main` and `checkpoint/visual-confirmation`: verified visual-confirmation baseline (`7dd651b`).
- `feature/catalog-mindmap` and `checkpoint/catalog-mindmap-voice`: the verified catalog/recorded-voice phase.

Before changing versions, keep the working tree clean (`git status --short`) and save wanted changes in a commit. Use `git switch main` for the baseline and `git switch feature/catalog-mindmap` for this phase. Switching source alone does not restart Docker. Rebuild the selected app from `02-Build/shopbot-ai` with `docker compose up -d --build app`. Existing database/media volumes are preserved; these additive migrations do not provide a database rollback or restore historical order data.

The deployed local image also preserves `shopbot-ai-visual-baseline` for immediate app rollback. Tag that image as `shopbot-ai-local-app`, then run `docker compose up -d --no-build app`. The updated candidate is `shopbot-ai-mindmap-candidate`. Refresh and choose New chat after an app restart because signed local test cookies are process-specific.

## Portable history

A metadata pointer copied to another computer will not carry its history. `03-Output/shopbot-ai-history.bundle` exports all current commits, branches and tags. The bundle is ignored by Git and contains no ignored `.env`, audio, node_modules or runtime database. From the project root, refresh it after a new commit with:

```bash
git bundle create 03-Output/shopbot-ai-history.bundle --all
git bundle verify 03-Output/shopbot-ai-history.bundle
```

To recover independently, clone the bundle into a normal local-disk directory:

```bash
git clone --branch feature/catalog-mindmap /path/to/shopbot-ai-history.bundle /path/to/local-shopbot
cd /path/to/local-shopbot
git switch main
git switch feature/catalog-mindmap
```

Environment settings and persistent database volumes are separate local runtime state. GitHub connection/push can be added when requested; local work does not require it.
