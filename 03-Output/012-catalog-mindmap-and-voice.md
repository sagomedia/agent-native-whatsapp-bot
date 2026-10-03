# Catalog mind map and recorded voice — verified 3 October 2026

## Delivered

Generic store → department → family → brand/specification catalog tools, indexed deterministic retrieval/ranking and bounded AI keyword planning. A second grocery store with 10,000 products verifies bounded retrieval (120 candidates, three returned photos), complete matched-scope brand counts, rare-brand lookup, use of the family/brand index and tenant isolation. The model receives a 24-product sample and a bounded hierarchy instead of the full variant catalog.

Broad blade discovery shows three distinct real photo families and matching type buttons. Category/brand/specification refinements use current, version-bound backend reads with no extra AI requests. Missing exact products retain the request, label related photos or ask about the job. No unrelated image is invented. Solvent cement, thread tape and epoxy have separate nature-based families; updating the synthetic taxonomy preserves edited product facts.

The local microphone records only after Record, stops before 30 seconds, releases its tracks, provides a preview/cancel step, then sends one bounded audio upload. Server decoding measures duration, rejects silence/malformed/oversized audio, disables network/file protocols and has time/output bounds. Normalized WAV is stored transactionally with scoped ownership and source hashing. Resending identical content cannot repeat an already processed request. Queued voice becomes stale if the draft changes before interpretation.

One free-only Gemini request transcribes and extracts a complete typed shopping plan. Product facts and consent remain deterministic. Missing transcripts, invalid plan bindings, duplicate filter keys, stale replies and malformed batches cannot partially mutate the draft. Spoken yes cannot accept product photos or submit an order. Photo acceptance and final review are separate actions.

## Offline verification

All **82 integration/regression tests pass**, zero live calls in those tests. Typecheck and production Docker build pass. Existing fixtures and voice/catalog tests use disposable PostgreSQL schemas; they do not reset the persistent app data. Detailed output: `012-regression-results.txt`.

The controlled 10,000-product fixture is a retrieval/index regression, not a production throughput guarantee. Browser-microphone testing uses a local synthetic spoken fixture, not the user's microphone. English speech was exercised; other languages/accents still need evaluation when preparing a real shop trial.

## Final live browser verification

The final deployed build passed desktop (1100 px) and mobile (390 px) Playwright checks with no page errors or horizontal page overflow.

1. “I need a blade”: one real Gemini call, three verified photos and matching product-type buttons. Choosing cutting wheels/discs narrows to that real family, with zero extra calls and no draft addition during browsing.
2. Record → Stop → Preview → Send: a **7.2-second synthetic microphone recording** requested two 1-inch PVC pipes and five bottles of solvent gum. One real Gemini call preserved both quantities and showed the current real product photos.
3. Select the Blueguard pipe photo, then the solvent photo: both accepted through current deterministic callbacks, zero extra calls. The final review displayed two checked products: 2 × ₹380 + 5 × ₹85 = **₹1,185**.
4. The final **Confirm request** button remained separate. **No orders were submitted by these live checks**, and no WhatsApp delivery occurred.

Evidence: `012-live-browser-evidence.json`, `012-catalog-desktop.png`, `012-catalog-mobile.png`, `012-voice-desktop.png`, `012-voice-mobile.png`, `012-voice-final-review.png`.

## Provider compatibility and honest accounting

The expanded structured-output grammar was rejected before generation by the current Gemini endpoint. A minimal schema was accepted but could not express the complete shopping decision. The implemented adapter uses `application/json` mode with the compact planning contract in its instruction, followed by strict wire and canonical Zod validation before any trusted operation. It makes one SDK request per ledger attempt, with retries and automatic function calling disabled. This is an explicit configuration change, not a hidden retry or paid fallback. Invalid JSON/plans retain the complete draft.

During the whole phase, the public live ledger records **12 free-declared attempts**: six provider rejections with no usage metadata, one intentionally minimal-schema diagnostic that generated an invalid decision without draft changes, and five successful calls (one JSON-mode diagnostic and two successful text/voice browser runs). Successful calls reported 29,351 tokens; the minimal-schema diagnostic reported 4,491. Lack of usage metadata on the six rejected requests is not a measured zero-token/provider-billing guarantee. Details: `012-inference-accounting.json`.

The **final smoke itself used two calls**. Paid inference remains disabled, the configured USD budget remains zero, and the existing shared project/model request-spacing/minute/day limits remain in force. No pricing authorization was broadened.

Official references: [GenerateContent JSON response configuration](https://ai.google.dev/api/generate-content#v1beta.GenerationConfig), [schema support and complexity limits](https://ai.google.dev/gemini-api/docs/structured-output), [model audio support](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite), [recorded audio input](https://ai.google.dev/gemini-api/docs/generate-content/audio).

## Local history and next integration boundary

`main` / `checkpoint/visual-confirmation` preserve baseline `7dd651b`. `feature/catalog-mindmap` and `checkpoint/catalog-mindmap-voice` preserve this phase. `GIT-WORKFLOW.md` records branch switching, rebuilding or using the saved rollback image, and portable Git-bundle recovery. Git's metadata is on the local disk because SMB chmod is unsupported; source remains on the shared workspace. Final Git switching/bundle verification evidence is in `012-git-verification.txt`.

The engine and local harness are implemented and running. Actual WhatsApp media/webhook/delivery integration, authenticated merchant catalog import, real catalog verification, approval/fulfillment and payments remain their separate milestones. No GitHub push was performed.
