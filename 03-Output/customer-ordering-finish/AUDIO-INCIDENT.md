# Live voice failure — 15 October 2026

The user's WhatsApp screenshots exposed two independent failures after deployment. Assistant mode and channel enablement were correct. The earlier offline suite had not established live provider-schema compatibility or decoder behavior on this VPS.

1. A 16-second inbound voice message (`982c8dee-4b66-4295-a2b2-5bf8b85da060`) was downloaded but hit `media_decode_timeout` before normalization completed. The decoder had a 20-second wall-clock limit. Because only normalized WAV bytes were stored, the owner dashboard also lost playback of this message.
2. A later 9.0135-second message (`4971d7ce-4a85-47a5-b04a-81eef4238f9f`) downloaded and decoded successfully. Its model call failed with `provider_http_400`. That failure was separate from audio download or speech clarity.

## Provider isolation

A metered diagnostic used the existing model, credentials, source code and budget ledger in a separate diagnostic conversation, with no WhatsApp output. The deployed response schema produced HTTP 400 `INVALID_ARGUMENT`. Changing only the provider-facing response grammar to a compact form produced a successful, usage-accounted response. A second comparison that removed bounds/pattern/format constraints while retaining the numeric schema version enum also succeeded.

The strict Zod contracts remain authoritative locally. The fix removes provider grammar constraints that this pinned model rejects; it retains required fields, allowed enum choices and object structure. UUIDs, schema version, item counts, purchase count precision, unknown fields, source evidence and business actions are still checked before mutation. Google's [structured output documentation](https://ai.google.dev/gemini-api/docs/generate-content/structured-output) describes the supported schema subset and notes that large or complex constraints may be rejected.

## Corrections

- Compact response grammar for unified text/audio/photo understanding. Prompt/release version advances to `2026-10-15.3`.
- Decoder allowance increased from 20 to 45 seconds within a 120-second media lease, retaining byte, duration and PCM output limits.
- A real local decode preflight runs before the WhatsApp media service can report ready. Missing or unusable ffmpeg now fails startup before accepting a voice test.
- Bounded original voice bytes and their validated MIME type are saved privately before conversion. Expired media worker claims cannot store an attachment. Reclaimed work reuses the saved original instead of downloading it again.
- Owner playback can fall back to the private original when normalization fails. AI input continues to require the normalized, validated WAV. A raw attachment never bypasses decoding or inference safeguards.
- Owner history distinguishes processing failures and timeouts from missing media. Customer timeout wording identifies slow processing without claiming the recording itself is unreadable.
- Additive migration 33 stores original voice bytes (maximum 1 MB) and download metadata. Other records and accounting are preserved.

## Regression coverage

The new checks cover a real 16-second Ogg Opus fixture, decoder preflight, original retention after a failed decode, authenticated playback fallback, cross-conversation isolation and compact provider grammar with strict local rejection of invalid quantities/UUIDs/version. The original audio fixture contains only a generated sine tone, with no customer speech.

Validation and deployment results are appended after verification. Diagnostic provider calls retain their paid usage or unknown holds in the existing spending ledger. No spending limit is increased or reset.
