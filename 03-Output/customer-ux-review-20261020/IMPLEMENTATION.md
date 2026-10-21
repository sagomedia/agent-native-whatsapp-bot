# Visual shopping repair — implementation for review

The approved plan is implemented on `codex/restore-visual-shopping-20261020`, based on deployed source `8d55b42` / PR #47. Tracking: [issue 48](https://github.com/sagomedia/agent-native-whatsapp-bot/issues/48). Deployment awaits the user's visual review and approval.

## Customer-visible result

| Request or situation | Implemented response |
| --- | --- |
| Show the current list/products, including previously delivered photos | Direct product image/carousel using a read-only `get_draft` result. No extra permission question. |
| Natural viewing paraphrase | New `view_list` understanding intent; bounded complete English/Tamil/Tanglish controls also work without a model round trip. The demonstrated spoken transcripts share the same routing. |
| A pending removal, line editor or unknown quantity | Viewing preserves cart contents, version and pending context. The original removal choice remains actionable. |
| A count or requested-amount change to an identified product | Keep the affected product photo and updated amount, with a full-list action. Retain estimate/conversion explanations. Completing an unknown count still uses the normal product-review progression. |
| A removal or explicit edit-and-view request | Show the remaining full current list. A mixed command still executes its validated edit; it is not swallowed by a viewing shortcut. |
| One product versus a longer list | One product image for a one-item review. Multi-item reviews retain the guide/carousel; larger views preserve every line across native groups. |
| A generic yes after photos, while an older bill is open | Show the bill again without submitting it. Its current explicit submission action still works. |
| An expired product check | Viewing works without exposing its expired approval. |

Ordinary price answers, variant narrowing, unknown facts, nonvisual conversations, current action IDs/version checks and separate product/bill/submission consent remain covered. Initial list creation and incomplete-product questions retain their existing progression; the edit-photo presentation is scoped to actual changes during visual ordering.

## Demonstration

- [Interactive before/after walkthrough](/home/gk-pc/whatsapp-bot-finish/03-Output/customer-ux-review-20261020/evidence/walkthrough.html)
- [Rendered walkthrough image](/home/gk-pc/whatsapp-bot-finish/03-Output/customer-ux-review-20261020/evidence/walkthrough.png)
- The six adjacent JSON files record actual native payloads for viewing, changing a count and removing an item, before and after.

The baseline was independently extracted from deployed commit `8d55b42`. All seven initial scenarios fail against it with the same synthetic fixtures used for the repair. The walkthrough is generated from these actual renderer outputs, then rendered and visually inspected in headless Chrome. It is a synthetic preview, not a screenshot of WhatsApp, fresh speech-recognition proof or a real customer delivery. Images are existing demo assets; prices/counts are synthetic test facts. Buttons in the walkthrough do not execute actions.

## Verification

The new regression file covers 21 scenarios, including whole-list viewing, the Tamil transcripts, semantic paraphrases in all three languages, pending context, count and measured-amount edits, mixed edit/view, single-item and twelve-item payloads, empty carts, negative controls, expired approvals and bill consent. Its synthetic audio fixture exercises the voice runtime with controlled recognition output and no network call.

The first broad run identified integration regressions and old assertions that required photos to disappear after edits. The implementation was narrowed to visual ordering and retained the normal missing-count/variant progression and estimate context. Existing photo-suppression assertions were updated to require the affected or remaining products; cart, quantity, action, duplicate and consent checks were kept.

Final combined verification passes: **825/825 integration tests**, including the 21 new visual scenarios; **4/4 Python tests**; production build and TypeScript. No failures or skips. Hosted check status is recorded on issue 48 and the pull request. [Verification metadata](/home/gk-pc/whatsapp-bot-finish/03-Output/customer-ux-review-20261020/VERIFICATION.json). No database schema change or dependency change is required. Prompt version is `2026-10-20.1`.

## Review and remaining acceptance

The next user review is the visual flow demonstrated above. This implementation does not establish the acoustic accuracy of the original recording, the exact stored provider decision for that customer's historical turns, or real-device carousel delivery. Those need a controlled authorized channel check after deployment approval. The first recording's new-list wording is retained in the vision as a separate acceptance concern; this repair does not claim to resolve every new-list speech interpretation.

The running service, live customer data, catalog, payments and allowance were not changed. No customer messages, stored-audio transfers, historical command replays or deployments were performed. Merchant data-preservation and fresh backup checks remain required for an approved activation.
