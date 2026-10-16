# Tamil-first demo verification — 4 October 2026

## Result

Tamil is the default for new native chats; explicit English/Tanglish preferences persist. The local demo is healthy at http://localhost:3017/native-test with the compiled Tamil image. The database/media volumes were preserved. Rollback image: `shopbot-ai-before-tamil:latest`; current candidate: `shopbot-ai-tamil-candidate:latest`.

All **99 regression/integration tests pass in the production Node 22.22.1 container**. Typecheck, production Vite/server build and Docker build pass. Added tests cover default/native session locale, no-inference language actions, Tamil/Tanglish quantity units, persistence/replay/scope, unchanged review/product bindings, stale Tamil consent rejection, localized failure/submission guards, translated family narrowing/rechecks, and actual-transcript preference changes. Original image, voice, paid/free guards and ordering tests remain passing.

## Live synthetic checks

- English “hi” in the default Tamil session returned the Tamil greeting with no provider attempt.
- A Tamil request for two cutting blades and available types returned actual H14/H15 images with Tamil discovery text. This was interpreted as read-only exploration; quantity was asked after choosing H14. Typed “ரெண்டு பீஸ்” led to a current separate **₹70** review. Explicit English switching retained the same review ID and draft; its refreshed confirmation was English. No order submitted.
- Explicit Tanglish selection used no provider call. “Enakku rendu 1 inch PVC pipe-um, 5 bottle PVC pipe pasai-um venum. Photos kaattunga.” retained both lines and quantities. Choosing actual H02 and H07 photos reached a separate **₹1,185** Tanglish review, with two checked products. No order submitted; choices/review used no extra provider call.
- Uploading the supplied public H14 demo photo with the Tamil caption “இந்தப் பொருள் போல கடையில் என்ன இருக்கு?” returned actual H14 photo/price and Tamil match-check prompt. Draft stayed empty and no order was submitted. Preview/cancel remained local; explicit send used one guarded visual request.

Exactly **three successful live attempts**, all `billing_state=free_declared`, model `gemini-3.5-flash-lite`, total **19,437 tokens**, no retries or paid fallback. No customer/personal photo or fresh personal voice recording was transmitted. The tests used only synthetic text and the public demo catalog photo. Voice preference is verified with offline decoded-audio/actual-transcript fixtures; no fresh acoustic Tamil/Tanglish accuracy claim is made.

## Saved evidence

- `015-live-tamil-proof.json`: the three synthetic conversation/attempt summaries and localized reply envelopes.
- `015-tamil-review.png`, `015-tanglish-review.png`, `015-tamil-photo-search.png`: visible browser checks.
- `015-node22-regression.log`, `015-container-build.log`: production runtime test/build results.

## Remaining demo/handover limits

Translations/local merchant vocabulary and catalog facts require owner review. Historical messages retain their original language. Read-only “what types” exploration may still ask quantity again after product selection; direct shopping-list quantities are preserved as verified above. One request per demo conversation remains the current lifecycle; submitted snapshots cannot be edited. Real WhatsApp delivery, merchant authentication/onboarding, staff approval, media retention and production access are later milestones.

GitHub account sign-in was verified for sagomedia. No repository was created/pushed by this task; repository name/URL is still pending. The candidate VPS was read-only inspected: hermes-mcp-test / sago-counter-ksmc / us-central1-a / e2-micro, Debian 13, 10 GB boot disk. Target confirmation and remote deployment remain pending. Workspace `HANDOVER.md` records the exact sequence, required information and coding/server/WhatsApp boundaries. No cloud resources, SSH access, firewall rules or Meta customer delivery were changed.
