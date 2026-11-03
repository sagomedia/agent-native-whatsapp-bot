# Voice correction and language investigation — 2 November 2026

## Accepted scope

Investigate the owner's VPS voice-edit failure and Tamil recordings saved in other scripts through read-only inventory MCP conversation evidence and retained provider diagnostics. Repair and verify locally against inventory-driven shopping behavior. Update the root README and agent handoff so another coding agent can continue in the prepared local checkout. Keep production conversations, orders and catalog unchanged. Do not send test messages on the owner's behalf or deploy this stage to the VPS.

## Evidence and diagnosis

- MCP conversation `3de6a0ab-460f-4d6e-b052-996774c4240b`, correction message `2d6a77ca-fc7e-4dc0-b066-8ce8cace584f`: ASR retained the Tamil correction. Both semantic attempts split a rejected blade identity and its intended plier replacement into an incomplete removal clause plus a new request. The evidence validator rejected that removal. This is distinct from a speech-model error.
- VPS messages `4128b737-4db7-4810-a86e-94c4bbc19b33` and `34d3fcb7-6f29-4690-84f1-4f1b5c54429a` contain Hindi and Telugu script. The current local test also retained Hindi for the owner's Tamil pipe/key-set recording. The dedicated Transcribe adapter omits language hints and therefore uses automatic detection.
- Google documents `transcription_config.language_codes` as BCP-47 hints. Saved Tamil/Tanglish can supply Tamil and English without sending cart/catalog facts or translating returned text: https://ai.google.dev/gemini-api/docs/transcribe#language-detection.
- The text instruction images in the screenshots represent unresolved requests. They are not proof that product photos are missing. Fix the failed understanding/retrieval path before changing presentation.

Private raw provider output and recordings remain outside Git. Message IDs are references for an authorized owner investigation, not permission to modify records.

## Verification status

Implementation and local verification in progress on `codex/voice-corrections-and-handoff`. Final checks and actual-device acceptance must be recorded before claiming this stage complete. The VPS remains on the prior deployed source; local routing was restored before editing.
