# The 50-product trial

## Step 1 — Choose the products

Use 50 sellable SKUs from the shop, preferably including roughly 15 visually distinct items, 20 similar-looking variants, 10 branded/model-specific items, and 5 loose or difficult-to-identify items. These are proposed sample groups, not a demand to force the shop's catalog into them.

Include different sizes/threads/materials where the merchant actually sells them. Define which specifications distinguish each SKU. Trial records may come from a partial export or a merchant-approved manual list. Full-store export is unnecessary at this stage.

## Step 2 — Prepare records and photographs

Obtain identifier, name, distinguishing specifications, selling unit, quantity precision, approved price, stock/unknown status, and source date. Take original product/packaging photographs; record which SKU or family each depicts.

AI can suggest classifications, aliases, and online reference images. Review mappings before using them. Preserve original photos and source provenance. Record preparation time, review/correction time, and one-time API costs.

## Step 3 — Build a local demonstration

Exercise text/photo/voice input, clarification, candidate selection, cart, and a staff-confirmed request. Use a simulator until WhatsApp is configured. Give the owner MCP plus a dashboard against the same backend.

If only synthetic data is available, label the demonstration accordingly and do not score real matching quality yet.

## Step 4 — Evaluate independently

Create at least 60 held-out cases, suggested as:

| Cases | Input and expected behavior |
| --- | --- |
| 15 | Text/local-name/specification requests; find the right candidate and clarify incomplete variants |
| 20 | New photographs of trial products, including several similar variants; retrieve useful candidates without guessing specifications |
| 10 | Photos or requests for absent products, or deliberately unclear photos; reject an exact match or hand off appropriately |
| 10 | Real voice notes with product names, numbers, and units; clarify ambiguous transcription |
| 5 | End-to-end requests including price changes, duplicate submission, and staff confirmation |

Do not reuse the exact indexed catalog image as every photo query. Store staff label expected products and necessary clarifications before scoring. Re-run affected cases after fixes and keep a separate fresh set for the final check.

## Proposed quality targets

- Zero invented price/stock facts, unsupported automatic order confirmations, or ambiguous variants silently placed in a cart in the test set.
- At least 90% appropriate handling across cases: useful correct candidate, necessary clarification, or justified no-match/handoff. Report raw counts and modality results; this small sample is directional evidence.
- For the 20 identifiable photo cases, report correct-family/candidate retrieval separately from exact-SKU selection. A legitimate clarification is not a photo failure; a confident wrong SKU is a serious failure.
- Correct line items, quantities, units, and confirmation state for every end-to-end request tested.
- No unauthorized owner actions and no duplicated orders from retries.

These are proposed pilot targets, not claimed performance or a guarantee for the full store.

## Step 5 — Measure cost and usefulness

Record AI/provider requests and actual usage per case, total customer conversation, successful selection, and submitted order. Record delivered WhatsApp messages separately. Report median, high-cost cases, and the largest retry/failure cost; do not project monthly cost from a single cheap response.

For a short real-store pilot, also record customer sessions, product selections, order requests, staff confirmations, completed sales when the merchant can verify them, staff handoffs, support minutes, and merchant feedback. An order request is not revenue. Pilot duration and spend cap remain to be chosen.

## Step 6 — Decide whether to expand

Expand after the critical failures are fixed and the merchant finds the workflow useful. Price full-catalog onboarding from measured per-SKU preparation effort, especially lookalike variants. Re-evaluate a larger representative set as coverage grows.

The ₹10,000 setup and ₹1,000 monthly offer remains a commercial hypothesis until setup effort, support, usage-charge handling, and merchant value are measured.
