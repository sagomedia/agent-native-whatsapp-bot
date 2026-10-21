# GitHub workflow, checkpoints and rollback

The private GitHub repository is [sagomedia/agent-native-whatsapp-bot](https://github.com/sagomedia/agent-native-whatsapp-bot). `origin` uses its HTTPS URL. `main` contains the current application plus repository setup; `feature/catalog-mindmap` retains the pre-setup application state. New changes should use a separate branch and pull request, with the automated checks passing before merge. See `CONTRIBUTING.md`.

Use a normal local-disk Git checkout for active development. The recovered checkout on this computer is `/home/gk-pc/whatsapp-bot-finish`; its working branch tracks the matching branch on `origin`. The historical SMB workspace can be disconnected. SMB does not support the chmod operations required to initialize Git metadata, so that older workspace's `.git` points to `/home/gk-pc/.local/share/shopbot-ai/project-git` on this computer. That pointer is specific to this machine. A GitHub clone on a normal local filesystem has its own portable `.git` directory.

- `checkpoint/visual-confirmation`: verified visual-confirmation baseline (`7dd651b`).
- `checkpoint/catalog-mindmap-voice`: the original verified catalog/recorded-voice phase.
- `checkpoint/language-storage-audit`: Tamil normalization/audio metadata fixes, catalog preparation kit and language audit. This checkpoint records live language failures; it is not a multilingual-readiness milestone.

Before changing versions, keep the working tree clean (`git status --short`) and save wanted changes in a commit. Use `git switch main` for current development or `git switch --detach checkpoint/visual-confirmation` to inspect the older baseline. Return with `git switch main`. Switching source alone does not restart Docker. Rebuild the selected app from `02-Build/shopbot-ai` with `docker compose up -d --build app`. Existing database/media volumes are preserved; these additive migrations do not provide a database rollback or restore historical order data.

The deployed local image also preserves `shopbot-ai-visual-baseline` for immediate app rollback. Tag that image as `shopbot-ai-local-app`, then run `docker compose up -d --no-build app`. The updated candidate is `shopbot-ai-mindmap-candidate`. Refresh and choose New chat after an app restart because signed local test cookies are process-specific.

Image-upload checkpoint: `checkpoint/image-search` records the customer photo upload and guarded read-only recognition flow. The deployed candidate is `shopbot-ai-image-candidate`; `shopbot-ai-language-baseline` preserves the prior app image.

## Portable history

A metadata pointer copied to another computer will not carry its history. `03-Output/shopbot-ai-history.bundle` exports all current commits, branches and tags. The bundle is ignored by Git and contains no ignored `.env`, audio, node_modules or runtime database. From the project root, refresh it after a new commit with:

```bash
git bundle create 03-Output/shopbot-ai-history.bundle --all
git bundle verify 03-Output/shopbot-ai-history.bundle
```

To recover independently, clone the bundle into a normal local-disk directory:

```bash
git clone --branch main /path/to/shopbot-ai-history.bundle /path/to/local-shopbot
cd /path/to/local-shopbot
git switch --detach checkpoint/visual-confirmation
git switch main
```

Environment settings and persistent database volumes are separate local runtime state. The GitHub repository and history bundle preserve tracked source, documents and demo evidence; neither contains ignored credentials or a runtime-data backup.
