# Owner dashboard and WhatsApp test audit

4 October 2026. This continues Astra’s high-effort connection plan (019).

## Implemented locally

Three owner views: conversations and takeover, submitted requests and accept/reject decisions, connections/usage with a shop-wide pause. Changes persist in PostgreSQL with an owner audit trail. Request decisions do not send notifications. The WhatsApp adapter and manual sending are not implemented or enabled. Preview-generated messages are explicitly distinguished from WhatsApp delivery.

Every owner API verifies the Cloudflare Access RS256 signature against keys from a pinned team domain, application audience, issuer, expiry, and exact owner email. Merchant scope comes from server configuration. Writes require the exact HTTPS Origin plus a JSON/action header. The public preview hostname excludes simulator and local AI endpoints. Owner preview refuses non-loopback binding, live mode and an attached native AI interpreter. No fake local signer or visual-test proxy is included in the release.

Migration 15 adds persisted store/conversation controls and audit records. Takeover invalidates work leases; workers lock the store before the conversation and check controls before applying results. Tests cover an in-flight interpretation followed by takeover and resume; its old reply is discarded.

Validation: Node 22 typecheck/production build, four Python catalog tests and 111 isolated PostgreSQL integration tests passed. Browser verification used a separate synthetic database and localhost-only visual test proxy, never merchant data. Takeover/return, pause/resume and accepting a request worked; the accepted decision remained after a page reload. The temporary visual server and disposable test database were stopped after verification.

Synthetic preview screenshots: [Conversations](020-owner-conversations-preview.png), [Requests](020-owner-requests-preview.png), [Connections and usage](020-owner-connections-preview.png). These document the prepared interface, not a published cloud dashboard or WhatsApp delivery.

## Verified Meta account state

Inspected the signed-in Meta developer dashboard and WhatsApp Manager. The two existing apps, **KSMC RETAIL** and **KSMC Agent Native**, both show the same Meta test sender (ending 5021) and the same test WhatsApp Business Account. Both apps are in development mode. Neither setup page currently has a generated token visible. A separate read-only Graph v25.0 sender lookup using the existing legacy token directly on the VPS succeeded; the configured sender and returned sender match the console. No credential values were printed or copied into the report/release. This establishes current sender-read access, not messaging permission, app ownership or token expiry.

WhatsApp Manager lists only **Test WhatsApp Business Account**. Its test sender is **Connected**, quality **High**, and the overview says **2 of 5 recipients added**. Recipient management explicitly permits up to five numbers for free test messages. Three slots therefore remain. Its **Add phone number** button is disabled. There is no enabled operation here to add another test sender; a second existing app already shares the first sender. Creating another app is not a verified solution to increase this account’s test-recipient limit.

A test *recipient* is a personal WhatsApp number authorized to receive test messages; a Meta test *sender* is the API number sending those messages. Extra recipient registration requires ownership verification in Meta. To test with more than the five permitted recipients, investigate onboarding an owned business number in a real WABA in the existing app; do not deregister a current WhatsApp Business mobile number as a shortcut. Current production-account eligibility, payment requirements, messaging permission, token app ownership/expiry and webhook subscription remain unverified. No app, number, token, subscription or test send was created/changed for this audit.

Account pages: [KSMC RETAIL](https://developers.facebook.com/apps/926846486795289/dashboard/), [KSMC Agent Native](https://developers.facebook.com/apps/1094580839886530/dashboard/), [WhatsApp Manager](https://business.facebook.com/latest/whatsapp_manager/overview/?asset_id=855545857568402&business_id=1478255187695455).

## Cloudflare / VPS state

Owner selected **Admin.sagomedia@gmail.com**. Signed-in Cloudflare One already has a team domain and shows 2 of 50 users, four existing applications, and five tunnels. No existing application covers the proposed ShopBot hostname. DNS inspection found no matching preview name or wildcard; existing records remain unchanged. The **ksmc-retail** tunnel has one healthy connector on **sago-counter-ksmc** and its IP matches the current VPS. The native-test tunnel still has two connectors.

Reuse the existing VPS-only retail tunnel for a new **shopbot-preview.sagoautomation.tech** ingress while preserving the old route and final 404. This avoids another cloudflared process on the small VM. Prepare an exact-email Access allow policy with six-hour sessions; associate it with the entire new hostname before publishing DNS. Validate the Access assertion at the origin and optionally in cloudflared.

The policy form is prepared, not saved. Browser confirmation rules require action-time approval for the persistent access policy and public route. Approval requested; publication and VPS owner configuration remain pending. No additional paid Cloudflare service is proposed. The Cloudflare plugin files/tools advertised earlier are absent in this session; connector discovery found no active Cloudflare/WhatsApp Composio connection. Account inspection used the signed-in browser instead.

Existing VPS preview is healthy. Before staging: 437 MiB available memory, 1.7 GiB free root disk. A temporary deployment SSH key renewed the already approved same-user access with one-hour expiry. The local temporary private key was removed after staging. The existing encrypted key and passphrase were not read or changed.

## Release staged, activation pending

The immutable release **preview-91954be7da20**, built from commit **989376a1cfb2205b7b7f620e99b067b8bc28db3b**, is uploaded and extracted into `/opt/shopbot-vps/releases/preview-91954be7da20`. Archive SHA-256: `93739ab23b9affa7089de4d9b3f7c16a373239190ef84b29e70778522db3c6b8`. The VPS checksum verification and upgrade script shell syntax check passed.

After staging, `shopbot-vps.service` remains **active**, and `/opt/shopbot-vps/current` still points to **preview-8f06fd2bcec5**. Root disk has **1.4 GiB free**, 85% used. No release switch, owner environment update, new database migration, Access policy save, ingress edit or DNS publication was performed. The new dashboard remains staged until the requested owner-only Cloudflare publication is approved. WhatsApp sending and AI inference remain disabled.

The staged upgrade script backs up the existing private environment and creates a PostgreSQL dump before switching releases, checks readiness, and restores the previous native release link on readiness failure. Its dump archive listing was designed as an integrity check; a full restore drill has not been performed. Production owner sign-in and live WhatsApp delivery are still unverified.
