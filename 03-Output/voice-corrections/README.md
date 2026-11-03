# Voice correction and language investigation — 2 November 2026

## Approved follow-up: actionable clarification

The owner approved implementation after clarifying that questions must identify the actual products and the uncertain action, rather than echoing the transcript or asking a generic permission question. Clear changes should execute; ambiguous target choices should name current rows, offer valid choices and resume the saved goal. Repeating an item with an explicit quantity sets its requested total unless a separately evidenced increase is stated. Represent every item in a multi-item request, including an unchanged existing item. Preserve unknown quantities and ask specifically for the affected item's total. Generate recovery copy from typed failures rather than matching English error-message words. Verify the reported unfinished Allen-key/pipe cart, unfamiliar inventory, selection answers, stale callbacks, negation and unchanged order-consent boundaries. Continue PR #91; do not deploy this follow-up to the VPS.

## Accepted scope

Investigate the owner's VPS voice-edit failure and Tamil recordings saved in other scripts through read-only inventory MCP conversation evidence and retained provider diagnostics. Repair and verify locally against inventory-driven shopping behavior. Update the root README and agent handoff so another coding agent can continue in the prepared local checkout. Keep production conversations, orders and catalog unchanged. Do not send test messages on the owner's behalf or deploy this stage to the VPS.

## Evidence and diagnosis

- MCP conversation `3de6a0ab-460f-4d6e-b052-996774c4240b`, correction message `2d6a77ca-fc7e-4dc0-b066-8ce8cace584f`: ASR retained the Tamil correction. Both semantic attempts split a rejected blade identity and its intended plier replacement into an incomplete removal clause plus a new request. The evidence validator rejected that removal. This is distinct from a speech-model error.
- VPS messages `4128b737-4db7-4810-a86e-94c4bbc19b33` and `34d3fcb7-6f29-4690-84f1-4f1b5c54429a` contain Hindi and Telugu script. The current local test also retained Hindi for the owner's Tamil pipe/key-set recording. The dedicated Transcribe adapter omits language hints and therefore uses automatic detection.
- Google documents `transcription_config.language_codes` as BCP-47 hints. Saved Tamil/Tanglish can supply Tamil and English without sending cart/catalog facts or translating returned text: https://ai.google.dev/gemini-api/docs/transcribe#language-detection.
- The text instruction images in the screenshots represent unresolved requests. They are not proof that product photos are missing. Fix the failed understanding/retrieval path before changing presentation.

Private raw provider output and recordings remain outside Git. Message IDs are references for an authorized owner investigation, not permission to modify records.

## Changes and additional findings
+
+- Dedicated recognition sends saved Tamil/Tanglish as Tamil/English BCP-47 hints. The audio remains verbatim and separate from shopping/cart history. Provider and prompt cache identities were advanced.
+- Identity corrections request one replacement edit with complete source evidence and retain known counts. Retry feedback explains that contract rather than repeating a generic rejection.
+- The same bounded fresh inventory facts are available to the single evidence-repair call, so repairing an action does not use up a separate product-grounding allowance and force valid matches into unresolved cards. Only validated selections scoped to that repair skip another semantic assessment. Initial selections still use normal grounding.
+- Grounding requests include exact item ordinals and replacement indexes. The strict compiler preserves their distinct roles, current target IDs, counts and unrelated rows.
+- Offline replay found another independent execution bug: a unique product's full specifications were copied into the saved customer-filter contract, which allows only six entries. Catalog rows with more metadata failed on bill refresh and rolled back valid changes. Full peer constraints now stay internal; saved plans retain bounded customer filters. Multiple observed semantic choices no longer inherit an alias match's unstated pack/size; explicit names/SKUs and customer hard constraints remain checked.
+- Mocked local checks no longer inherit the development profile's handwriting-image/paid-inference settings. Reusable synthetic fixtures now assert known counts, candidate photos and expected product names.
+
+## Verification status
+
+Branch: `codex/voice-corrections-and-handoff`; linked acceptance issue #88 remains open.
+
+- Build/type-check and four Python catalog checks passed. The full local PostgreSQL run passed all 1,114 tests. After the final multi-choice refinement, all 78 focused catalog/voice/edit tests passed on the final source; hosted CI will run the entire updated suite from a clean checkout.
+- A five-turn real-Gemini synthetic flow completed add, identity replacement, total-five edit, unrelated-item removal and negated removal; the surviving plier had five real photo candidates and no order was submitted.
+- Stronger separate count-preservation evaluation exposed the metadata-refresh bug. Replaying those exact saved synthetic model responses offline after the fix produces three real plier candidates at count three, keeps the unrelated tree tool at count one with its three candidates, and has no action error. That replay uses no provider calls or WhatsApp transport.
+- Google accepted the new language hints on the repository's public Tamil welcome recording; recognition and interpretation both succeeded and the transcript remained Tamil.
+- The latest cumulative local CLI evaluation spend is US$0.177626 of the existing US$0.50 ceiling, with no held usage and no reset. Conservative full-context reservations blocked later calls before nominal spend reached the ceiling. A smaller *actual* API output cap was used for the last small synthetic run; reservations and usage accounting remained intact. Do not describe every earlier experimental run as passing.
+- Automatic approval review blocked sending the owner's specific retained local recording to Gemini again, pending explicit permission for that recording. It was not replayed externally. Actual phone voice quality, carousel rendering and taps still need owner acceptance.
+
+The VPS remains on the prior deployed source. This stage has not been deployed. Local routing was restored before editing and can be started again for the owner's connected test after checks pass. No production catalog/customer/order records were changed and no customer message was sent by the coding agent.
