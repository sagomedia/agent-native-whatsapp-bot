# VPS rollout and recovery

The isolated VPS source branch is `release/gemini-transcription-20261021`. It starts at the exact running source commit `f3a982747e95e37bbe58e678ea43209b696f5b54` and cherry-picks this feature. The application dependency lock, dashboard assets and resources match the previous installed release; source additions affect only transcription, routing, accounting and release metadata.

The final package is `preview-b7b0e81fdbba`, source `c5c873e8707e99bd3e2fe493b4b9c41650b58a28`, artifact SHA-256 `319d75a28b4985ef4223544b41c9b3bb41c8f93bde90b6102123807d2915624b`. Previous release: `preview-ee9facc93dc7`.

Configuration adds only `GEMINI_TRANSCRIPTION_MODEL=gemini-3.5-transcribe`; Flash-Lite, unified understanding, existing budget and WhatsApp flags remain configured as before. Schema stays at 40. The deploy procedure makes the usual private database backup and retains the original environment separately. It checks unchanged products, original source photos, store settings and carts with no new inbound activity. It verifies the service PID, installed artifact fingerprint, process working directory and both model variables.

Recovery uses the previous immutable release and the `environment-original` file in the private before-deployment directory under `/var/backups/shopbot-migration/transcription-20261021/`. Restore that environment with its original owner/mode, atomically point `/opt/shopbot-vps/current` to the previous release, restart `shopbot-vps.service`, then verify `/health/ready`. No schema rollback or database restore is required for this feature; keep the backup available rather than replacing current customer data.

A synthetic recording was evaluated on the VPS using one recognition call and one interpretation call. The transcript was “I need two rolls of PTFE tape and three paint brushes.” The draft retained quantities 2 and 3. The existing budget recorded an estimated 1,671 micro-USD, with no allowance increase or customer send. The isolated synthetic ledger was archived and its schema removed; its charge remains in the production budget. This is API integration evidence, not real Tamil/Tanglish quality acceptance.
