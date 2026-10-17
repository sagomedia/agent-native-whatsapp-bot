# VPS release and reviewed catalog — 17 October 2026

The 3,000-catalog runtime is deployed and healthy. The separate 300-row research package passed preparation, target-shop dry-run, full draft intake and owner API verification. It has not been published to customer inventory.

## Verified deployment

- Active server: `preview-4722ac672acd`, source `4a3054d7dff09b745b425cbd759c77076bdabad1`, artifact `1ff15c4118351e1c42a04a71c202cf7c556b17850feb1cf6fefccc44ce8dcefe`.
- Schema 36, readiness HTTP 200, runtime provenance recorded, unauthenticated owner API rejected with HTTP 403. Environment hash and existing 39-product checksum unchanged. Worker defaults remain 1/1/1.
- GCP disk and online ext4 root expanded from 10 to 30 GiB. Cloud snapshot and private database backups retained; no transaction history was deleted.
- Actual VPS dump restored into an isolated temporary database. Migration run twice; all 40 retained table snapshots unchanged. Both owner API versions and 39 current SKU/name searches passed. The actual previous executable became ready on schema 36 in about 30 seconds and shut down cleanly with channel/provider credentials disabled. Temporary database removed.
- The installed operational bundle `preview-35f8b621d69c` is built from `a268f286c4806478961b2c4e3f2e33c34664e8bd`, artifact `db3146834173f7dd2c281b9c5cc1b48f33f24203b3392d212e8ea7eaf0c66c33`. It adds the two compiled import/capacity entrypoints; all 145 shared runtime files match the running server exactly. The server was not switched to that tool bundle.

## Catalog checks and intake

All 300 source rows are accounted for: 297 distinct draft targets and three explicit duplicate exclusions. Nineteen variants remain marked for extra identity/specification review. Six problematic photos are omitted; 291 supplied images remain unconfirmed. Prices and stock stay unknown. Source folders are preserved.

The actual-identity disposable PostgreSQL fixture passed 609 checks across exact names/SKUs, a small written alias sample, shared-alias ambiguity and mass/volume constraints. No model, speech or WhatsApp calls were made. Synthetic 3,000-row and dashboard checks are recorded separately; they are not merchant-voice accuracy claims.

The real shop dry-run passed with zero SKU or taxonomy conflicts. A 25-row staging canary passed. All 297 targets are now staged, with three duplicate exclusions and zero failed/pending rows. Five raster-decoder timeouts on the shared VPS were resolved by the bounded background allowance below. All 226 proposals completed before the tool switch retained their IDs, versions and input hashes. The owner API reaches all drafts in 12 pages of at most 25 rows. The existing 39-product checksum and environment remain unchanged; readiness is HTTP 200. Original bytes (54,866,582) and normalized bytes (19,250,439) are retained for 291 unconfirmed photos. Six image holds remain omitted. No products were published.

Bulk source hash: `fbf10bab0ca61a983b446404bc01dd0308a3eb7acc32b707d9118c89499b113c`. Batch: `reviewed-300-pass2-20261017`.

## Background decoder repair and measured space

The final installed background tool is `preview-cbfc555901df`, source `5da6a546819ac1fa7d3bdbc75bb2bb301ec2065b`, artifact `57dae08b53ae6add5351b825b056cd1b15319f7078eb4cbd9748accadb5135a5`. Full GitHub CI passed. Only its sequential bulk path requests 30 seconds per decoder subprocess; customer image paths keep their 10-second default. Only the image helper, proposal helper and bulk service compiled files differ from the preceding tool bundle. The running server remains the verified release above. The identical batch/source hash was resumed, preserving prior proposals; no database restoration or source edits were used to repair timeouts.

The post-import read-only measurement found 20,172,386,304 bytes free. Using all 291 normalized draft photos, the 3,000-product planning projection needs 4,750,189,852 additional bytes plus a 3,146,145,792-byte reserve. It fits this filesystem sample; future image sizes, physical database/WAL/backup retention, CPU, memory, provider limits and real traffic still need measurement. Full machine-readable evidence is in `deployment-result.json`.

## Remaining acceptance

Merchant confirmation of product identity, selling basis, price/stock state and exact photos is required before publication. Check existing shop equivalents; no automatic fuzzy merge with the 39 current products occurs. See [owner review checklist](OWNER-REVIEW-NEXT.md).

Fresh real-speaker Tamil/Tanglish voice and real-device WhatsApp order/pickup/cancel testing remain open. QR generation does not establish bank capture. No claim of production 3,000-product traffic capacity is made from local fixtures or filesystem projections alone.

Tracking: [runtime PR #22](https://github.com/sagomedia/agent-native-whatsapp-bot/pull/22), [assembly PR #24](https://github.com/sagomedia/agent-native-whatsapp-bot/pull/24), [native tools PR #25](https://github.com/sagomedia/agent-native-whatsapp-bot/pull/25). [background deadline PR #26](https://github.com/sagomedia/agent-native-whatsapp-bot/pull/26). PRs remain open drafts; deployed source IDs above distinguish deployment from merging.
