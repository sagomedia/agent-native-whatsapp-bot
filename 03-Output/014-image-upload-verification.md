# Image upload and catalog search verification

3 October 2026. Local app deployed and healthy at `http://localhost:3017/native-test`.

Implemented Upload image → JPG/PNG/WebP preview → optional caption → explicit Find matching products. Customer photo stays in chat history through scoped retrieval. Image-derived searches are read-only; selection/quantity/review use the existing deterministic tools and consent gates.

## Offline checks

All 90 integration/regression tests pass; typecheck and Docker build pass. Seven new image tests cover raster decoding/size/dimensions, spoofed and malformed inputs, PNG/WebP, strict image planning, unrelated/malicious model output, idempotent retries, caption preservation, scoped access, stale queued images, shared free quota and rejection of image input under paid text billing. Invalid uploads fail before inference. Scripted provider transports establish backend behavior rather than live recognition quality.

## Actual browser and free-tier evidence

Used the public demo `resources/catalog/ksmc-demo/images/H14.jpg` with the authored Tamil caption “இது என்ன பொருள்? இதுபோல் கடையில் உள்ளதா?” No personal photos or recordings were sent.

- Browser file chooser, local preview and caption input worked. Previewing alone made no AI call.
- Initial live attempt failed output-plan validation; no draft change. The image contract was adjusted to accept omitted/null optional filters while retaining strict canonical validation, and bounded validation metadata was added. The initial exact rejected field cannot be reconstructed because it predated those diagnostics; do not claim its cause was definitively established.
- The subsequent live attempt succeeded: Gemini interpreted the product photo, and backend search returned H14 Pro-Cut Cutting Wheel 4 inch with its actual catalog image and ₹35 demo price. It clearly labelled these as possible matches. Draft was empty before explicit selection.
- Both customer and catalog images decoded in the browser. Uploaded raster normalized to 1280×853 JPEG, 239,546 bytes. The source catalog image displayed at its original 1920×1280 dimensions.
- Choose this → quantity 2 → separate ₹70 review worked with no additional inference. One successful-model call in that conversation; zero submitted requests.

Two actual free attempts total (one failed, one succeeded), with 3,933 + 3,990 = 7,923 provider-reported tokens. No hidden retries or paid inference. Shared quota and all existing database/media volumes were preserved. Saved previous image as `shopbot-ai-language-baseline` for app rollback.

## Practical limits

This is a successful single-product photo smoke test with a Tamil caption, not a broad visual recognition benchmark or full Tamil reply implementation. English backend reply templates remain. Uploaded photos provide uncertain clues and do not establish stock, measurements, compatibility, brand authenticity or order consent. Product photos/data remain unverified demo references. Multiple-product/handwritten-list extraction and real WhatsApp image receiving/delivery are separate milestones.

Evidence: `014-image-match.png`, `014-image-review.png`, `014-image-live-evidence.json`, `014-regression-results.txt`. Reusable implementation guide: `02-Build/shopbot-ai/IMAGE-SEARCH.md`.
