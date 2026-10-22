# Dedicated voice transcription

Accepted scope, 21 October 2026: deploy on the main VPS a voice pipeline using `gemini-3.5-transcribe` for speech recognition, followed by `gemini-3.5-flash-lite` for understanding and existing retail tools. Text and photo interpretation continue using Flash-Lite.

Use the existing 30-second normalized WAV boundary, verbatim transcription and automatic language detection. Keep recognition separate from catalog/history context; preserve the recognized text through interpretation. Reserve and settle each model call with its own verified rate profile in the existing attempt ledger and cumulative budget. Retain bounded retries, current consent guards and cart preservation on failures.

Verify mocked API contracts and runtime routing, the PostgreSQL regression suite, build and hosted checks. Deploy an immutable verified release with database/configuration backup and rollback. Preserve current customer data, original photos, owner settings, sending policy and the existing budget. Record actual VPS provenance and the result of a bounded synthetic model smoke test separately from real Tamil/Tanglish accuracy.
