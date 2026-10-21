# Branch cleanup — 21 October 2026

The repository had 30 remote branches and 26 open pull requests. New stages had been stacked on earlier branches while their pull requests remained open. [PR #54](https://github.com/sagomedia/agent-native-whatsapp-bot/pull/54) consolidates the published source into `main` with a merge commit, preserving the original history.

- Previous `main`: `fccf1e39e130d565ff838fdfc28076304b551fbf`.
- Published source selected for consolidation: `9b7bafe0ce68b6c719103bfb61961dc91c5fca36`, 99 commits ahead of the previous `main`.
- Consolidation merge: `e97777cd7fd16dad728f46103f0fb09d6422b565`.
- All 30 original remote branch tips were verified as ancestors of the selected source and of the consolidated `main`.
- 28 historical branch names were removed. The 25 older open pull requests were superseded by #54; GitHub marked many as indirectly merged, and the remaining nine were explicitly closed with a consolidation link.
- `main` and `codex/dashboard-usability-20261021` remain. The latter is retained because its existing local checkout contains a newer unpublished scope commit and unfinished inventory edits. Those edits were saved separately and left in place, outside this consolidation.
- All four `checkpoint/*` tags are unchanged. A complete pre-cleanup history bundle was saved locally and verified before any branch removal.

The cleanup changes repository organization and workflow documentation. It does not deploy the application, change runtime data, contact customers or complete the outstanding owner/device/payment acceptance. Those issues, including #52, remain open. The existing setting to delete merged branches automatically remains enabled.

## Verification

GitHub [Project checks for 9b7bafe](https://github.com/sagomedia/agent-native-whatsapp-bot/actions/runs/39612194309) completed successfully at the exact selected head: build/typecheck, PostgreSQL integration and catalog preparation. Branch ancestry was independently checked against a fresh full-history mirror. Deletions used an atomic Git push with expected commit leases; already-removed branches were accounted for separately. A moved branch would have stopped deletion.

The accompanying documentation change is checked for whitespace, local links and the recorded branch/tag ancestry. Its hosted checks must pass before merge. Source consolidation leaves device and deployment acceptance separate.

## Original branch tips

The full mapping is also available in [branch-map.json](branch-map.json). The commit column records each tip before consolidation; it is not a claim about future branch positions.

| Original branch | Original tip | Disposition |
| --- | --- | --- |
| `codex/bulk-image-deadline-20261017` | `5f3c224422b0d183f4eddd087e50045cb2d3aaf9` | Retired; history preserved in main |
| `codex/catalog-3000-implementation-20261017` | `4a3054d7dff09b745b425cbd759c77076bdabad1` | Retired; history preserved in main |
| `codex/catalog-bulk-20261017` | `14ce1f3ef880d7b88b6d1ab30f1f82cffffd17d3` | Retired; history preserved in main |
| `codex/catalog-discovery-pages-20261017` | `b35300bf21db3a0fd77bf42b978d891393bf556c` | Retired; history preserved in main |
| `codex/catalog-native-tools-20261017` | `db3b2ceb59f91161b5f3cdd4193dd16ecdfca4e4` | Retired; history preserved in main |
| `codex/catalog-owner-pages-20261017` | `ea9a2ee863cfd63fc46bf2735f7d0179a058229d` | Retired; history preserved in main |
| `codex/catalog-reference-photos-20261017` | `99c2bf0b053ed260f191f41a6aaf26c4e1a99046` | Retired; history preserved in main |
| `codex/catalog-retrieval-scale-20261017` | `a6cafe44166d94a4080374b64c55ab4290231e83` | Retired; history preserved in main |
| `codex/catalog-review-later-20261017` | `8f4b135324d76cf63fe949a29c3dfa3226d6720f` | Retired; history preserved in main |
| `codex/compact-corrections-20261018` | `1f3826682f003c9f058f406d8b4c309cafdf9d6f` | Retired; history preserved in main |
| `codex/compact-whatsapp-20261016` | `44f3d6898c8b0303612487a245dd4a38ecdca0d6` | Retired; history preserved in main |
| `codex/convenience-stock-20261016` | `00b45563d342dba3b801977ffdf4120bcf44e1f8` | Retired; history preserved in main |
| `codex/conversation-review-fixes-20261014` | `2403f76e0c770b9217fc191d2dc88ff8581560d3` | Retired; history preserved in main |
| `codex/crud-language-20261019` | `9b61d8ac6cea8a080c56a4a1da0f00e1563bdb10` | Retired; history preserved in main |
| `codex/customer-ux-20261019` | `8d55b42516db98f68154f8ff8bc005cbf686e0c6` | Retired; history preserved in main |
| `codex/dashboard-usability-20261021` | `9b7bafe0ce68b6c719103bfb61961dc91c5fca36` | Keep: unfinished local inventory work |
| `codex/decision-layer-research-20261018` | `e506b2d832dd538ab4709bf875d2b173d172761e` | Retired; history preserved in main |
| `codex/finish-customer-ordering-20261015` | `2c90ece1e036fdcd390827587fa592c342c4a660` | Retired; history preserved in main |
| `codex/next-demo-plan-20261018` | `780ce26e26d6503ad4a9422aa516a4a1f2f9e509` | Retired; history preserved in main |
| `codex/order-review-workbench-20261020` | `f3a982747e95e37bbe58e678ea43209b696f5b54` | Retired; history preserved in main |
| `codex/owner-readiness-bulk-facts-20261018` | `ea6db8d2d1375e026eff1ac75e7a3023e6fe5501` | Retired; history preserved in main |
| `codex/product-editor-image-speed-20261018` | `42fe130a4842489883eb1caf19442d26f5b47a2b` | Retired; history preserved in main |
| `codex/restore-visual-shopping-20261020` | `d2edf59bbd1cc9e7c275c991721d7d3faea1050c` | Retired; history preserved in main |
| `codex/reviewed-catalog-assembly-20261017` | `42098d1571dfba8bf3e6a5d9e7f45262ede4a140` | Retired; history preserved in main |
| `codex/voice-cart-targets-20261019` | `1d27a0cd056c09292ce69474f5b59d37032d4a88` | Retired; history preserved in main |
| `codex/voice-compound-removal-20261019` | `c30dca25a9e53eba4ec982b68c8592b38d0b66b7` | Retired; history preserved in main |
| `codex/voice-order-recovery-final` | `2955219c07d28ec47f612e9f6b920757becbb414` | Retired; history preserved in main |
| `codex/whatsapp-delivery-recovery-20261019` | `d8c8deaa437bf9ae18750ed528da822c4b4804a8` | Retired; history preserved in main |
| `feature/catalog-mindmap` | `1c47977025f0bb94a1f6f223043011a85bc0b6e7` | Retired; history preserved in main |
| `main` | `fccf1e39e130d565ff838fdfc28076304b551fbf` | Keep: published baseline |

## Recover an earlier branch

Every retired tip remains in `main` history. Fetch `main`, verify the selected SHA from the mapping, then create a new local branch at that SHA. For example:

```bash
git fetch origin main
git merge-base --is-ancestor d2edf59bbd1cc9e7c275c991721d7d3faea1050c origin/main
git switch -c recovered/visual-shopping d2edf59bbd1cc9e7c275c991721d7d3faea1050c
```

Save local edits before switching. Source recovery does not restore a database, customer media or configuration. See [GIT-WORKFLOW.md](../../GIT-WORKFLOW.md) for the daily workflow and checkpoint recovery, and [issue #55](https://github.com/sagomedia/agent-native-whatsapp-bot/issues/55) for this maintenance task.
