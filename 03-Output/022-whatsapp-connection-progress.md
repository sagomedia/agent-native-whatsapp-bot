# WhatsApp test connection — 5 October 2026

The signed WhatsApp receiver and durable text sender are implemented and deployed on the existing VPS. The owner dashboard and its exact-email Cloudflare Access policy remain active. The approved privacy policy is published at https://demo.sagoautomation.tech/privacy and saved in Meta. With separate action-time owner approval, KSMC RETAIL was published; Meta now shows **Published**.

The existing Meta sender and one verified test recipient ending **7308** were explicitly selected by the user. No new app, sender, tunnel, payment method or paid AI service was created. The legacy token and secrets were reused privately on the VPS; no secret values were copied into source, reports or chat.

## What is verified

- Node 22 production build/typecheck and all **114** isolated regression/integration tests pass. The three channel tests cover exact-byte HMAC signatures, challenge validation, hostname/asset/recipient isolation, durable duplicate prevention, owner pause/takeover, bounded delivery recovery, early delivery callbacks and closed reply windows. Transport is mocked in those tests; they are separate from the real Meta checks below.
- The existing token passed a read-only Graph v25.0 audit: valid, matching KSMC RETAIL, system-user type, messaging/management scopes, matching WABA/phone assets and existing app subscription. The returned expiry values are zero, which does not make a revocable token irrevocable.
- The existing app callback **https://demo.sagoautomation.tech/webhook** and `messages` subscription were retained. A Meta dashboard synthetic webhook reached the VPS with a valid signature and HTTP 200 at **05:26:46 UTC**. Its fake asset identity was correctly ignored; this is not proof of receipt from a phone.
- The user's “hello” before publication and “hello again” after publication did not produce stored inbound messages when checked. We did not invent a successful conversation or blame a specific Meta restriction without evidence.
- One **hello_world / en_US** bootstrap template was sent through the existing token to the approved test recipient at **05:45:20 UTC**. Meta accepted it with HTTP 200. Signed callbacks recorded **sent** at 05:45:24 and **delivered** at **05:45:25 UTC**. The corresponding two public webhook requests returned HTTP 200. This establishes an actual test send and working callback route, not a ShopBot-generated reply or a read receipt.
- A private one-attempt ledger at `/var/backups/shopbot-migration/whatsapp-bootstrap-7308.json` prevents automatically repeating the bootstrap send if its outcome is ambiguous. Its provider identifier is retained privately; the report contains only the recipient suffix.
- A subsequent audit correlated the exact bootstrap provider identifier with its persisted `sent` and `delivered` callbacks. Inbound and automatic outbox counts were both zero at that check. The public authenticated dashboard shows **Receiving test events**, its last signed event at **11:15 am IST**, automatic sending disabled and deterministic/paid inference disabled. “Receiving test events” includes delivery callbacks and does not imply that a customer message was received.

## Current gates and remaining test

The receiver is enabled. **Automatic processing and sending remain disabled** while waiting for the user to reply “hello shopbot” directly in the received test-number chat. AI and paid inference remain disabled. The initial channel adapter deliberately uses a deterministic English interpreter and the Workshop supply demo catalog. Voice, photo downloading, real merchant fulfillment, manual WhatsApp replies and customer request-decision notifications are not part of this initial test.

After an actual approved-recipient inbound message is stored, the next step is enabling the bounded test processing/sending gates, observing an actual reply and its signed delivery status, and checking the public owner dashboard. The backend remains restricted to the exact selected recipient. No general customer rollout is implied by Meta app publication.

## Deployment and rollback

Current release: **preview-d8e6cf45a689**, code commit **37af236**. Previous channel release **preview-075ed9e1fb19** (commit **daca41c**) and prior owner release **preview-91954be7da20** remain available. Current archive SHA-256: `e6e64b5437585412f1189a12ba781ebd213b72ea3a1b8ee50762c95b148b326e`. Bundles contain compiled app, catalog and deployment files, excluding secrets. Existing immutable Node/dependencies were hardlinked only after version and lockfile equality checks, avoiding another large dependency installation on the 10 GB disk.

Migration 16 adds durable channel identities, provider-message deduplication, recipient conversation mapping, delivery outbox and status records. A Meta acceptance is displayed separately from delivered/read. Unknown send outcomes are held instead of blindly retried. Owner pause, takeover and revision controls are checked before sending; test replies require an incoming-message window under 24 hours.

Root-private backups:

- `/var/backups/shopbot-migration/whatsapp-20261005T052611Z`: pre-channel environment/tunnel configuration and previous release path.
- `/var/backups/shopbot-migration/owner-20261005T052611Z`: upgrade environment/database backup.
- `/var/backups/shopbot-migration/owner-20261005T053144Z`: policy contact-readability upgrade backup.
- `/var/backups/shopbot-migration/privacy-20261005T053414Z`: pre-publication environment/tunnel configuration.

Database archive listings were checked during upgrades; this is not a full restoration drill. The last capacity check showed **1,167,953,920 bytes free** and app MemoryCurrent **59,523,072 bytes**, with MemoryMax **402,653,184 bytes**. The app and retail tunnel were active, and the private environment remained mode 0600. The VM remains e2-micro; no paid resize or extra cloud resource was requested.

The existing retail tunnel routes **only `/webhook` and `/privacy`** on `demo.sagoautomation.tech` to loopback port 3017. Other demo paths retain their previous route. The whole dashboard hostname retains Cloudflare Access and independent backend JWT validation. Missing signatures/verification tokens fail with 403; the WhatsApp hostname cannot expose `/owner`. No new DNS or tunnel was added in this channel phase. The incompatible desktop retail connector remains disabled to avoid the earlier intermittent dashboard 404s; the separate native-test tunnel is unchanged.

The public policy matches the actual implementation: test data stays until operator deletion, backups can retain copies, media is not downloaded and message content is not sent to an AI provider. Cloudflare's documented [email obfuscation exclusion](https://developers.cloudflare.com/waf/tools/scrape-shield/email-address-obfuscation/) keeps the approved contact readable without changing account security settings.

## Evidence

[Signed receiver dashboard](022-whatsapp-receiver-verified.png), [initial Meta publication requirement](022-meta-publish-requirement.png), [reviewed policy](022-private-policy-review.png), [public policy](022-public-privacy-policy.png), [Meta requirements complete](022-meta-ready-to-publish.png), [Meta Published status](022-meta-published.png), [live delivery-callback dashboard](022-whatsapp-delivery-callback-dashboard.png).

This report supersedes the channel-not-implemented status in report 021. It does not claim the pending phone reply or automatic conversation test has passed.

## Temporary access cleanup

Removed the two temporary remote release archives and the activation/staging helpers created by this session. Installed releases, the one-attempt test-send ledger, private deployment backups and application data were retained. Removed the temporary local SSH private/public key files. The original encrypted key was unchanged. After the original temporary grant expired during setup, it was refreshed with the same account, permissions and explicit one-hour expiry; this report does not describe that metadata entry as manually revoked.
