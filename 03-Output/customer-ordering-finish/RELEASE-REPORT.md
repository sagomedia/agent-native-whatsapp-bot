# Deployment handoff — 15 October 2026 (America/Adak)

The customer ordering implementation is deployed on the existing VPS. A live voice incident revealed decoder timeouts and a provider schema rejection after the original deployment. The audio corrections and their measured live verification are documented in [AUDIO-INCIDENT.md](AUDIO-INCIDENT.md). The final runtime source commit is `423611b957c77f09ebc3df62d0b74baa8f032b01`.

| Item | Verified value |
| --- | --- |
| Active release | `preview-5e57206b0419` |
| Artifact SHA-256 | `ab656eaf8a9991748c36be4c9a25512273fa65e1d615468aaa48ff8dd8e788ec` |
| Source branch | `codex/finish-customer-ordering-20261015` |
| Database migration | 26 → 32 → 33 |
| Prompt version | `2026-10-15.3` |
| Understanding schema | 2 |
| Runtime verification | 133 artifact files; content verified as both root and the service user |
| Integration tests | 526 passed, 0 failed; final dashboard adjustment also passed release build |
| Service | active/running; no automatic restarts at final check |
| Model | Existing `gemini-3.5-flash-lite` configuration retained |

## Delivered behavior

- Natural Tamil with familiar English shop words, shared model style instructions, and a fixed 8.8-second welcome recording queued once per conversation.
- Voice, text and photo proposals pass through catalog, quantity, product evidence, version and consent checks. No new recognition-accuracy percentage is claimed.
- Estimates preserve paragraph spacing and every item across WhatsApp pages. Unresolved items retain their names and counts without a fabricated price. Only known-price items contribute to the subtotal; an entirely unpriced list does not show a complete ₹0 bill.
- Maximum-size lists with 50 long unknown product names remain fully visible. The footer uses the excluded item count rather than duplicating every long name.
- A ₹10 UPI QR and same-phone payment link use the exact configured VPA. References preserve the complete request UUID in a 35-character alphanumeric value. NPCI specifies a reference limit of 35 characters/digits; uniqueness is also required in the [Google payment request guidance](https://developers.google.com/pay/india/api/web/create-payment-method). See the [NPCI merchant circular](https://www.npci.org.in/PDF/npci/upi/circular/2017/Circular18_BankCompliances_to_enbaleUPIMerchantecosystem_0.pdf).
- A customer payment claim does not verify receipt. The authenticated owner checks their bank/UPI app and records the actual transaction reference. One receipt reference cannot verify multiple orders. The advance remains separate from payment of the full bill.
- Unknown items can receive a complete owner quote. Customer approval of the current final bill is required before that quote becomes effective. The ₹10 verified advance is credited in the bill.
- Post-order status questions remain actionable. Whole acknowledgements and unrelated messages have an explicit silent outcome. Mixed thanks plus an edit is processed as an edit.
- Amendments preserve the original submitted snapshot. The customer approves the proposed change, then the owner accepts, declines or quotes it. Catalog changes prevent acceptance of a stale price. Closed orders cannot accumulate unusable amendment requests.
- Late advances for closed orders are recorded as needing refund. Refund completion is recorded only after the owner supplies its actual reference; the application does not execute bank refunds.

## Verification and preservation

`npm run build`, TypeScript checking, native script syntax checks and the original 523-case integration suite passed. The audio correction expanded this to 526 passing cases; see the incident document for actual VPS decoder/provider checks. The final test fixture cleanup also passed its focused QR test. The release packager verified the exact artifact set before upload, and the VPS verified its content again.

A private copy of the real database was actually restored into disposable local PostgreSQL 17, migrated twice and compared using hashes of protected records. Conversations, requests, inference budgets, provider attempts and the WhatsApp outbox were preserved. The temporary database and dump are removed after the rehearsal.

The original deployment preserved all three order snapshots, the spending ledger and owner handling modes. Subsequent live voice attempts and the isolated audio diagnostics retain their actual usage or unknown holds. The $4.50 inference ceiling was not increased or reset. No WhatsApp customer message or bank payment was sent by the deployment diagnostics. The audio incident evidence records the final preservation checks.

The owner quote editor was inspected at desktop and mobile widths, with no page errors or horizontal overflow. Synthetic receipt recording and quote submission both returned HTTP 200. The invoice remains gated until required checks and customer consent are complete.

An independent QR decoder read the generated request and confirmed ₹10.00, INR, the exact recipient and the 35-character reference. This validates the encoded request, not bank settlement or the recipient account's live acceptance.

Final public checks: welcome audio HTTP 200 (`audio/ogg`, 32,125 bytes), owner login HTTP 302, direct owner API without a JWT HTTP 403, and public simulator HTTP 404. Native readiness returned `ready`.

## Backups and recovery

A 150-second orchestration timeout and a 30-second cold-start window caused intermediate attempts to return to the working release. Orders and accounting remained intact. The native upgrade now allows a bounded 120-second cold start. The audio correction took a new consistent backup, applied additive migration 33, and passed readiness. A final dashboard update reused that completed backup and passed the same bounded readiness check; environment and audio backend were preserved.

The latest completed database backup is `/var/backups/shopbot-migration/owner-20261016T060306Z/database.dump`, taken before additive audio migration 33. Its size is 63,370,024 bytes and `pg_restore --list` succeeded before activation. The same private directory retains the environment and previous release pointer. Earlier backups and the original private environment remain available. The verified voice executable `preview-fc1cd867ff4c`, pre-audio release `preview-3edcf01749a1`, and original pre-task release `preview-539dc247a0a0` are retained. The final dashboard artifacts use the same audio backend; their only other server byte difference is a removed trailing space in already-applied migration 23, checked explicitly before activation. Dashboard recovery metadata is in `/var/backups/shopbot-migration/audio-ui-20261016T060958Z/`.

For an executable rollback, atomically point `/opt/shopbot-vps/current` at the reviewed prior release and restart `shopbot-vps.service`, then check native readiness. Keep the additive database in place. Do not automatically restore an older database after new customer traffic, and do not use the legacy-app rollback script for this native cutover.

## Owner acceptance still needed

1. Open the [owner dashboard](https://shopbot-preview.sagoautomation.tech/owner) and select your conversation. The reported voice failure occurred while the assistant was handling that chat; takeover was not its cause.
2. Send a real Tamil voice list with known and unknown items. Check the recognized counts, photos, spacing and spoken welcome.
3. Check the bank-resolved recipient name, make one real ₹10 test transfer, and verify the actual receipt in the owner dashboard. Wallet/deep-link compatibility and receipt cannot be proven by offline QR decoding.
4. Finish an owner quote if needed, approve it as the customer, then test ready/collected status and an amendment before collection. Send thanks, followed by a status question.

Existing WhatsApp test-recipient restrictions and the 24-hour service-window rules remain in effect. This deployment does not establish unrestricted production onboarding or a measured real-accent recognition rate.

Review [the implementation and flow](IMPLEMENTATION.md), [the actual fixed Tamil phrases](ACTUAL-TAMIL-COPY.md), and [the original phrase checklist](TAMIL-REPLY-REVIEW.md). The standalone Mermaid flow is in `CUSTOMER-FLOW.mmd`.

## Source handoff

Source and evidence are committed in `/home/gk-pc/whatsapp-bot-finish`. The original deployment files are under `/home/gk-pc/shopbot-finish-release`; the audio correction archive and updated portable source bundle are under `/home/gk-pc/shopbot-audio-final-release`.

The runtime source was verified on GitHub branch `codex/finish-customer-ordering-20261015` at `423611b957c77f09ebc3df62d0b74baa8f032b01` using `git ls-remote`. This audio diagnosis/deployment run did not perform that publication. Incident evidence and the final handoff are also saved locally in the source checkout.
