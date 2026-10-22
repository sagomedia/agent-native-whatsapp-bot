# GitHub workflow, checkpoints and rollback

The private repository is [sagomedia/agent-native-whatsapp-bot](https://github.com/sagomedia/agent-native-whatsapp-bot). `main` is the current published source baseline. The 21 October consolidation preserved the ordering, catalog, WhatsApp recovery and owner-dashboard history in `main` and retired 28 obsolete branches. [The cleanup record](03-Output/branch-cleanup-20261021/README.md) maps every original branch to its preserved commit.

The inventory follow-up now uses `codex/inventory-workspace-20261021`, created from the consolidated `main`. The accepted scope and implementation from `codex/dashboard-usability-20261021` were carried onto this separate branch after PR #54 merged the earlier dashboard. [Issue #52](https://github.com/sagomedia/agent-native-whatsapp-bot/issues/52) links the current draft and hosted checks. Both original commits remain preserved; this revision does not delete either branch. Deployment and owner/device/payment acceptance remain separate from source consolidation.

## Daily development

Use a normal local-disk checkout. Save any wanted edits before switching branches, then start each new change from current `main`:

```bash
git switch main
git pull --ff-only origin main
git switch -c codex/describe-the-change
```

Push the change and open a pull request against `main`. Run the checks in [CONTRIBUTING.md](CONTRIBUTING.md), verify the hosted result, and merge when they pass. Retire the completed branch and start the next change from updated `main`. GitHub's automatic deletion of merged branches is enabled. Preserve unfinished local work before deleting branch names or pruning local history.

For a consolidation of stacked branches, use a merge commit to preserve their original ancestry. Verify that every branch tip being retired is an ancestor of `main`; a matching filename or similar commit message is insufficient. A branch that has moved since the audit needs another check.

The historical SMB workspace can be disconnected. Its `.git` points to `/home/gk-pc/.local/share/shopbot-ai/project-git` on this computer because SMB did not support the required Git metadata operations. This pointer is specific to that machine. A normal local clone has its own portable `.git` directory. Do not reset or replace the existing checkout to resolve a missing shared-drive mount.

## Checkpoints and historical local images

The four existing tags remain unchanged:

- `checkpoint/visual-confirmation`: verified visual-confirmation baseline (`7dd651b`).
- `checkpoint/catalog-mindmap-voice`: original verified catalog/recorded-voice phase.
- `checkpoint/language-storage-audit`: Tamil normalization/audio metadata fixes, catalog preparation kit and language audit. This records live language failures, not multilingual readiness.
- `checkpoint/image-search`: customer photo upload and guarded read-only recognition flow. This preserves the old `feature/catalog-mindmap` branch tip.

Keep the working tree clean before inspecting an earlier checkpoint:

```bash
git status --short
git switch --detach checkpoint/visual-confirmation
# Inspect the historical source, then return to the published baseline.
git switch main
```

Earlier local Docker experiments used the image names `shopbot-ai-visual-baseline`, `shopbot-ai-mindmap-candidate`, `shopbot-ai-language-baseline` and `shopbot-ai-image-candidate`. These are historical names; inspect the actual local images and deployed release before using them. Switching source does not rebuild Docker or update the VPS. Database and media volumes need their own backups; additive migrations do not supply a database rollback.

## Portable history

A Git metadata pointer copied to another computer does not carry its history. A bundle exports committed source, branches and tags. The ignored `03-Output/shopbot-ai-history.bundle` can be refreshed from the project root:

```bash
git bundle create 03-Output/shopbot-ai-history.bundle --all
git bundle verify 03-Output/shopbot-ai-history.bundle
```

To recover independently, clone the bundle onto a local disk:

```bash
git clone --branch main /path/to/shopbot-ai-history.bundle /path/to/local-shopbot
cd /path/to/local-shopbot
git switch --detach checkpoint/visual-confirmation
git switch main
```

Retired branch commits remain reachable through `main`. Use the commit mapping in the cleanup record to recreate an old branch if needed. The cleanup also saved and verified a full pre-cleanup bundle locally. Neither GitHub nor a history bundle includes ignored credentials, uncommitted edits, customer uploads or a runtime-data backup. Preserve those separately.
