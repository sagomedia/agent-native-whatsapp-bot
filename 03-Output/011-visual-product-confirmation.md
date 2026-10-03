# Visual product confirmation — 3 October 2026

Implemented explicit product photo/name acceptance for the native image-demo store. Inferred exact matches and ambiguous options are staged together, with request labels and quantities. A page contains up to three requested items and ten product cards. The next page appears only after customer response; no automatic fan-out. Quantities, product acceptance and final order submission remain separate.

Backend product acceptance is durable, scoped to the conversation and current displayed batch, expires after fifteen minutes, and revalidates catalog identity. Wrong-item corrections replace the intended draft line and revoke its earlier acceptance. Quantity-only changes preserve product acceptance. Stale/foreign/unshown choices and invalid bulk batches cannot partially apply. Missing photos show an explicit fallback. The legacy mock store retains its previous policy; the native image-demo store enables the new policy on startup.

Validation:
- Production build and TypeScript checks passed.
- Complete integration suite: 63 passed, including 10 new visual-confirmation tests in temporary PostgreSQL schemas. Existing chats/orders were retained.
- Real free-tier Gemini test: two 1 inch pipes, solvent gum, and one garden hose. Two pipe alternatives plus solvent and hose appeared in one four-photo reply. Missing solvent quantity remained unknown after tightening the prompt.
- “5 bottles” updated the solvent proposal without another AI call or implicit product acceptance.
- Selecting a pipe photo then accepting the remaining two items created a three-photo final review. Total: ₹1,365 (two local pipes ₹490, five solvent bottles ₹425, hose ₹450). No request was submitted.
- Desktop (1100 px) and mobile (390 px) rendering inspected. Mobile page had no document-level horizontal overflow, and the UI reported no JavaScript errors. Product photos were visibly loaded. Keyboard/message controls and current-card selections worked against the real local API.

This change used two real free-tier Gemini calls, no paid inference. The first request exposed an omitted-quantity guess; the prompt was strengthened and the repeated request left it null. A browser-script session-start race was corrected before the successful end-to-end check; an intermediate retry sent no AI request. Offline tests use controlled provider responses and real database/tools; they do not claim to measure model accuracy.

The browser evidence contains synthetic conversation state and messages, not cookies, API keys or environment settings. Actual voice recording/transcription and WhatsApp delivery remain upcoming adapters. Local photo grouping remains a channel preview; real delivery must satisfy account/template eligibility and the delivery planner.

Use http://localhost:3017/native-test, refresh and choose New chat. Try “I want two 1 inch pipes, solvent gum and one garden hose”, then “5 bottles”. Choose the pipe photo and add the correct remaining items. The final Confirm request button sends a local test request only when explicitly selected.

Final deployment verification: both local containers report healthy. The final mobile build also passed greeting → Chemicals browse → solvent photo selection → “5 bottles” → photo review, using zero AI attempts and submitting zero requests. The composer is disabled while a new chat or message is being processed, preventing a typed draft from being cleared by an unfinished request.
