# Inventory-driven decisions — issue #88

The owner reported that product-name branches and fixed command wording had replaced the intended semantic shopping flow. The read-only MCP audit found failed product identification after successful voice recognition, a lost spoken four-litre measurement, and misleading inventory aliases. The correction belongs in understanding, retrieval and decision flow; updating every reported word is not a general solution.

## Implemented behavior

- Unified understanding carries independent per-item keywords, canonical search identity, valid inventory family IDs, source count/attribute evidence and observed SKU selections. The original utterance remains separate from search hypotheses.
- The live/native runtime retrieves current inventory facts and permits one metered semantic grounding pass, within the existing two non-recognition-attempt limit. It checks at most three item searches per pass and supplies at most ten candidate facts per item. When literal search is empty, up to two alternative keywords recover facts for semantic review. These candidates are not automatically displayed.
- The grounding compiler preserves requested items, source quantities/attributes and cart actions. It scopes selected SKUs to the item's actual observation, including attribute-expanded searches. A failed grounding retains the request without approving suspect aliases. Exact current names/SKUs and bound button actions avoid the additional inference.
- Product-specific cement/solvent/pipe/pump decisions and the fixed three-pipe menu are removed. Categories, counts, example photos and refinement actions come from the current inventory taxonomy. Category questions retain the active item's description/size; independent lines remain intact.
- Fresh semantic selections can use a synonym despite a literal noun mismatch. Brand, physical measurement, specification, store and selected-SKU constraints remain backend checks. A suggested SKU still needs product consent and separate order submission.
- Typed cart targets and count evidence accept unfamiliar command/number wording without extending a verb list. Current source evidence, negation, ambiguous targets, stale callbacks, quantity/measurement distinction and whole-list confirmation remain checked. Shared legacy removal forms retain their tested safeguards.
- A spoken four-litre pack cannot become one litre. Unclear counts remain unknown. A bare number at an unresolved selling-unit question stays in clarification, while a verified displayed selling unit accepts a bound count reply.
- Product questions no longer contain a special cutter branch. Safe model-authored multi-option questions remain visible; broad single-option matches use a generic purpose question.

Language/unit normalization and legacy compatibility parsing remain. This is not a claim that every regular expression or conditional has been removed. Product meaning should not be encoded as an ever-growing application policy table.

## Deployment provenance

The repair branch starts from GitHub main `cb23698b085e85357f69d8fc7994caae39f8d844`. Read-only VPS inspection identified running source `fd48696145cc313d3cb2e4cb20385ca626a05313`, tree `ea3aa6a51736974e7ecccb5a672ce108fb44b354`, artifact hash `86e0d42c8579df8356ccf6403e523aa7e919dc05f5ffc146d4c30c1ce669760b`, release `preview-a9e152f77cf6`.

The exact unpublished TypeScript commit could not be recovered from available Git history. Its compiled application and package files were preserved privately. Rebuilding GitHub main and comparing every compiled server module found five differences: conversation runtime, unified understanding adapter, Google interpreter, visual ordering and catalog discovery. All five are within this repair. Their generic quantity UI, verified-unit replies, unresolved-count recovery and bounded Tamil source-suffix recovery are retained; product-specific gates are replaced by the inventory flow. No schema/dependency upgrade is introduced.

This comparison preserves evidence for review; it does not recreate the original unpublished Git ancestry. Do not treat a GitHub merge as deployment, or discard other open branches merely because they overlap.

## Verification and remaining acceptance

Synthetic regression coverage includes an unrelated grocery inventory, changed taxonomy labels, noisy queries, erroneous aliases, foreign-item SKU injection, count/attribute preservation, unfamiliar removal/increment wording, read-only lookups/prices, stale actions and a complete five-item visual checkout. The expected phone transcript now records real family actions and never invents an unavailable pump category. The historical billing test pins its own date so crossing a calendar month does not invalidate the fixture.

Run the production build/typecheck, complete isolated UTF-8 PostgreSQL suite and four Python catalog checks on the final source. `scripts/evaluate-inventory-grounding.mjs` provides an explicitly enabled, capped live-model check against a separate schema containing a read-only snapshot of public inventory facts. It records attempts and estimated spend, creates no WhatsApp transport, does not alter production catalog/customer/order records, and does not claim voice recognition or device acceptance.

Fresh actual voice/WhatsApp-device acceptance and owner-led correction of inaccurate catalog metadata remain separately tracked in issue #88. Existing incorrect customer carts are not silently rewritten.
