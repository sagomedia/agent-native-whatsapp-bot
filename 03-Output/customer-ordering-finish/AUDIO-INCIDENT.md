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

The full integration suite passed **526/526**, with **56/56** focused contract checks after the final schema refinement. The release build includes TypeScript checking, the dashboard build and server compilation. A final dashboard-only adjustment preserves missing-photo explanations alongside the new voice failure details; it passed the same release build.

## Actual recovered voice

The failed original was refreshed from Meta into private service storage on the VPS: 31,159 bytes of Ogg audio. The patched decoder converted it to a 16.7135-second, 534,876-byte mono 16 kHz WAV. Decoder preflight plus conversion took 27.019 seconds under the service identity, 128 MB Node heap, 256/384 MB service memory limits, private temporary directory and filesystem protections.

The original audio then went through the patched compiled adapter and normal metered conversation runtime in a separate diagnostic conversation. The provider returned a strictly validated successful identification, with four draft items for review, one usage-accounted call and an estimated 2,071 microusd. No WhatsApp outbox entry was created and the three existing orders were unchanged. The diagnostic unit used 164.5 MB peak memory and exited successfully. This verifies that the recovered voice can be decoded and interpreted; it does not measure recognition accuracy against a human transcript.

Diagnostic provider calls retain their paid usage or unknown holds in the existing spending ledger. No spending limit is increased or reset. The final deployment and playback restoration passed the checks below.


## Deployed result

- Active release: `preview-5e57206b0419`; source `423611b957c77f09ebc3df62d0b74baa8f032b01`; prompt `2026-10-15.3`; schema migration **33**.
- Artifact SHA-256: `ab656eaf8a9991748c36be4c9a25512273fa65e1d615468aaa48ff8dd8e788ec`. Startup verified all 133 files. The final audio backend matches the successful live probe; an audited concurrent merge removed only one trailing space from already-applied migration 23.
- Fresh database/environment backup: `/var/backups/shopbot-migration/owner-20261016T060306Z/`. The 63,370,024-byte dump passed `pg_restore --list` before activation. Final dashboard recovery metadata is under `/var/backups/shopbot-migration/audio-ui-20261016T060958Z/`.
- The historical failed message now has its recovered original and verified WAV saved under its original conversation/actor and source version. Authenticated playback loading returned the 534,876-byte WAV. Its inbound message remains processed; no shopping request or customer reply was replayed.
- Before/after hashes matched for all three original orders and all advance, amendment and quote records. Customer draft versions, contents, assistant/owner modes and revisions matched. Spending ceiling and committed/held ledger values matched the pre-activation snapshot after the metered diagnostics.
- Native readiness returned `ready`; service remained active with **0 automatic restarts**. Public welcome audio returned **200** (32,125 bytes); owner login **302**; direct owner API without its JWT **403**; public simulator **404**.
- The temporary integration PostgreSQL container and its anonymous volume were removed. Customer audio and private backups remain on the VPS; no customer voice recording is committed to the repository.

Evidence: [live decoder/provider result](evidence/audio-live-probe.json), [deployment and preservation](evidence/audio-deployment-proof.json), [test summary](evidence/audio-test-summary.json), [service health](evidence/audio-service-health.txt).

The next acceptance step is a fresh customer Tamil voice note on WhatsApp and review of the proposed products/counts. The original failed message has been preserved without changing the current order. Human accent accuracy, bank settlement and unrestricted WhatsApp onboarding are not established by this audio incident check.
