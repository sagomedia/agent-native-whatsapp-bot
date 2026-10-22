# Inbound audio: 90-second limit

22 October 2026. Owner request: increase inbound audio from 30 seconds to 1 minute 30 seconds. Implement and deploy on the current combined owner/transcription release c8b51ae; preserve its dashboard, transcription pipeline, budgets and customer data.

Update duration and bounded payload ceilings consistently through WhatsApp downloads/original retention, decoder, normalized WAV storage, model admission and both recognizers. Raise the compressed/raw upload cap to 4 MiB so a 90-second 16 kHz mono WAV (2,880,044 bytes) fits. Update the local recorder and English/Tamil/Tanglish duration guidance. Add a forward-only schema migration for the existing media constraints; do not rewrite historical migrations or audio.

Use the existing 120-second processing deadline, 45-second provider/decoder call ceilings and bounded 4096-token Transcribe reservation unless evidence shows a change is required. They are processing deadlines, independent of recording duration. No budget increase, model change or live paid evaluation is authorized by this request.

Verify 30–90-second acceptance, 90-second boundary, over-limit rejection, payload admission/storage/retained playback, upgrade preservation and idempotency. Run build, focused and full integration tests, catalog checks and hosted CI. Package a clean verified release, back up the VPS, activate with existing upgrade tooling and confirm readiness, schema/data/config preservation and compiled boundary checks without sending customer messages or invoking providers. Keep actual phone recording/transcription testing distinct from synthetic acceptance.
