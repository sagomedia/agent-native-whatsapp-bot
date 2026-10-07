# Automatic WhatsApp test replies enabled — 5 October 2026

The user explicitly requested enabling backend replies for the already approved verified number ending **7308**, after receiving the bootstrap message. The backend now processes incoming text and sends replies automatically to that one recipient. AI, free inference and paid inference remain disabled; the adapter uses the deterministic English interpreter and Workshop supply demo catalog. This is not a general customer rollout.

## Verified result

The actual WhatsApp conversation appeared in the owner dashboard with the user's **hi** initially pending. Following activation, the backend processed that message and **hello**, creating real outbound messages. Meta's signed callbacks confirmed both replies **delivered** at **11:39:44 am and 11:39:56 am IST**, each with one send attempt and no delivery error. The corresponding inbound messages were processed, and both the app and existing retail tunnel were active. The subsequent screwdriver request also reached the same scoped conversation; it is not evidence of AI or of a complete merchant catalog.

The live dashboard shows **Assistant active**, **Receiving test events** and replies restricted to approved recipients. The owner can use **Pause assistant** to hold shop-wide replies or **Take over** to hold replies in a selected conversation. Manual replies from the owner dashboard and request-decision notifications remain unavailable.

The final authenticated browser check showed six actual inbound texts processed and all six corresponding outbound replies labeled **delivered**, including subsequent cutter requests. The deterministic interpreter appended some follow-up text to its unresolved query and the demo catalog did not match the screwdriver/cutter requests. This is an observed interpretation/catalog limitation, not a WhatsApp transport failure or evidence that the AI agent is active.

## Configuration and recovery

Changed only `WHATSAPP_PROCESS_ENABLED` and `WHATSAPP_SEND_ENABLED` from false to true in the root-private VPS environment, after validating the exact app/phone identities, a single allowlisted recipient ending 7308 and all three AI/inference flags remaining false. The existing signature, asset, recipient, owner-control and 24-hour reply-window checks remain in force. Existing cloud resources, credentials, Access policy, tunnel and release **preview-d8e6cf45a689** were retained.

Before activation, backed up the environment to **`/var/backups/shopbot-migration/test-replies-20261005T060935Z/shopbot-vps.env`**. The app restarted and readiness returned 200. The activation helper would restore the prior environment and restart if readiness failed; that rollback was not needed. Restoring this specific backup disables automatic processing/sending again without reverting the receiver or public privacy policy. Already delivered messages cannot be recalled by configuration rollback.

No source-code change or new build was required for this configuration activation. The deployed code's previous production build/typecheck and 114 isolated tests remain the relevant code verification; real inbound/processed/outbound/delivered records verify this activation.

This supersedes the pending inbound/reply test and disabled automatic gates in [report 022](022-whatsapp-connection-progress.md). No new token or sender was generated. Temporary SSH access used the previously approved account and explicit one-hour expiry; local temporary key files were removed after verification, and the original encrypted key was unchanged. Private metadata access was not described as manually revoked.

Evidence: [actual WhatsApp conversation and delivery labels](023-whatsapp-delivered-replies.png), [enabled test connection controls](023-whatsapp-replies-enabled.png).
