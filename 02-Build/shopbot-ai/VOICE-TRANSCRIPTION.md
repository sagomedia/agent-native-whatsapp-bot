# Dedicated voice transcription

Enable `GEMINI_TRANSCRIPTION_MODEL=gemini-3.5-transcribe` with the existing paid multimodal inference authorization. Keep `AI_MODEL=gemini-3.5-flash-lite` and the existing cumulative `AI_BUDGET_USD`; enabling recognition never resets or increases it. The separate setting is exposed by the authenticated release endpoint. The release manifest identifies the supported transcription model; the feature field identifies whether it is active.

The normalized WAV recording (at most 30 seconds / 960044 bytes) goes to the official pinned SDK's Interactions API in verbatim mode with automatic language detection and `store=false`. No conversation, catalog, language assumption, tools, thinking settings or smart rewriting is sent to recognition. One HTTP request corresponds to one ledger attempt; only the runtime may retry one transient 502/503/504 response. Empty, incomplete, malformed and mismatched responses never reach shopping tools.

The recognition transcript is saved in its own `recognize` attempt and passed as text to Flash-Lite with the current shopping context. Unified understanding remains enabled for that text and for photos. The recognized transcript remains authoritative even if interpretation returns a transcript field. Existing bound shortcuts can finish after recognition without another AI call. Shopping identification, bounded repair and recommendations retain their existing validation and consent checks. Duplicate events reuse committed results rather than retranscribing.

Speech is accounted using the [Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing) verified on 21 October 2026: USD 2 / million audio input tokens and USD 12 / million text output tokens. Each recognition reserves 4096 input and 4096 output tokens (USD 0.057344) as a conservative ceiling for the bounded recording. Verified actual usage settles the charge; missing or mismatched usage keeps the existing unknown-cost hold. Flash-Lite retains its own rate profile. Both stages debit the same durable store budget.

The prior combined Flash-Lite path remains available with the setting absent. Disabling it is a deliberate configuration/rollback action, never an automatic fallback after an ASR failure. Such failures retain the cart and ask for another recording or typed text.

References: [Audio transcription](https://ai.google.dev/gemini-api/docs/transcribe), [model limits](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-transcribe), [Interactions request and usage schema](https://ai.google.dev/api/interactions-api).

Offline tests and synthetic speech establish routing and integration only. Accuracy on new Tamil/Tanglish voice notes needs real-device review.
