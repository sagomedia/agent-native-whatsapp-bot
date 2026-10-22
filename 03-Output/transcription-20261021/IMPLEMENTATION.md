# Voice transcription before shopping understanding

Voice can now use `gemini-3.5-transcribe` for verbatim recognition, followed by `gemini-3.5-flash-lite` for shopping interpretation and existing tools. Configure the separate `GEMINI_TRANSCRIPTION_MODEL`; do not replace `AI_MODEL`.

The dedicated adapter uses the pinned official SDK's Interactions API, inline normalized WAV, automatic language detection, no stored interaction, no hidden retries and no conversation/catalog prompt. It preserves the 30-second input limit and rejects malformed, incomplete, failed or wrong-model results before shopping actions. SDK HTTP errors are normalized so the runtime's one transient retry remains durable and bounded.

Unified understanding receives the recognized text and current shopping context. The recognized transcript remains authoritative through tool validation and message persistence. Bound shortcuts may finish without another model call. Recognition is excluded from the existing two semantic-call allowance; all calls retain the overall four-attempt and turn-deadline limits.

Transcribe has its own verified input/output rates, request-admission hash, reservation and usage settlement. Both stages charge the existing store budget. Missing usage keeps the existing unknown-cost hold. The optional configuration requires existing paid multimodal authorization. The verified release manifest identifies transcription support and the authenticated release endpoint reports the active setting.

Focused verification: 79 tests passed; typecheck passed. The tests cover the actual SDK HTTP contract, no hidden retries, admission limits, speech rates and unknown holds, explicit configuration, two-stage runtime routing, failed recognition/cart preservation, transient retries and duplicate events. Full regression, hosted CI and VPS results are recorded separately after completion.

The VPS package will be based on running commit `f3a982747e95e37bbe58e678ea43209b696f5b54` plus this focused change, preserving the currently deployed dashboard while unrelated owner UI work continues on main. No new dependency or database migration is required. Real Tamil/Tanglish accuracy remains a device acceptance item in issue #58.
