# Inbound voice notes up to 90 seconds

22 October 2026. Tracking issue #61. Accepted scope c9cc1a8; based on deployed combined dashboard/transcription source c8b51ae.

## Behavior

Inbound notes accept up to **90 seconds (1:30)**, measured from decoded samples. Both a full 90-second WAV and WhatsApp-style Ogg Opus recording decode without truncation. Over-90 recordings fail before inference; the customer message says 90 seconds and retains the current list.

A shared voice policy aligns ingress, normalized WAV storage and model admission. Raw uploads/downloads are bounded to **4 MiB** (5,592,408 base64 characters); the normalized 16 kHz mono PCM WAV is at most **2,880,044 bytes** (3,840,060 base64 characters). The native local upload route admits the bounded body with room for JSON metadata. Speech and free-tier recognizers accept the same ceiling; inference admission bounds aggregate bytes by media type and prevents a mixed image/audio payload.

The browser recorder advertises 90 seconds in English, Tamil and Tanglish and stops at approximately 89 seconds to allow container padding, as the preceding 30-second recorder stopped at 29. Preview/send/cancel behavior remains. Native WhatsApp recordings up to exactly 90 seconds are accepted independently of that local recording control.

Schema **41** only widens existing `voice_media` byte/duration constraints and the retained `whatsapp_media.original_audio` byte limit. Historical migration definitions remain unchanged. Migration tests start with old constraints and audio, rerun setup twice, then store/play a 90-second recording and its retained original. Existing recordings and access scoping are preserved. A rollback to 30-second code would not support newly accepted long notes; keep the forward migration and use an audio-aware release after these arrive.

The 120-second turn deadline, 45-second decoder/provider ceilings, 4096-token Transcribe reservation, model selection, budget limits and retry identity remain. Recording length is separate from computation time. A longer note does not promise transcription accuracy or latency; real user phone recordings remain an acceptance exercise. No paid/provider request or customer send is needed for deployment checks.

## Verification

Five new integration scenario groups cover decoded 30.2/60/90-second WAVs, a full 90-second Opus note, 90.01/91/100 rejection, both recognizers and admission before transport, WhatsApp download/retention above the old 1 MiB cap, over-limit download rejection, populated schema-40 upgrade/repeatability, stored playback and cross-actor denial, database duration rejection, and an authenticated 3.84 MB local HTTP voice payload. Providers are mocked.

Existing speech/voice tests now reject the new boundary and oversized payload rather than asserting the obsolete 30-second limit. Existing invalid/silent audio, inference budgets, replay, recovery, signed local access and tenant isolation assertions remain. A browser check against production assets uses a simulated microphone/clock: all three languages record through 88 seconds, stop at 89, and retain preview before send. Screenshots and machine results are in `evidence/`.

Final local checks: production build/typecheck, **859/859** PostgreSQL tests (zero skips), five focused boundary/upgrade/HTTP scenarios including the full Opus fixture, catalog **4/4**, and all three recorder languages pass.

See `VERIFICATION.json` for final checks and the linked PR/issue for the deployment outcome. Actual fresh phone/WhatsApp transcription is not claimed by synthetic tests. No extra inference budget or sender configuration is enabled.
