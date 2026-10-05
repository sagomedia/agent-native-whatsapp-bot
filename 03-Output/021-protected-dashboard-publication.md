# Protected VPS dashboard publication

5 October 2026. This supersedes the publication-pending state in report 020.

## Published configuration

Dashboard: **https://shopbot-preview.sagoautomation.tech/owner**.

The user explicitly approved owner-only publication in this chat. Created Cloudflare Access application **ShopBot owner preview**, ID `5937aae0-592c-4ff9-809d-5d047680b08f`, covering the entire exact hostname. Its only Allow policy is **ShopBot preview owner**, ID `7c3f6cdf-0517-4a4c-8abf-0313f15059ff`, with one exact-email Include rule: `admin.sagomedia@gmail.com`. Application and policy session durations are both six hours. Only the existing One-time PIN identity provider is selected; accepting all identity providers and Cloudflare One Client authentication are disabled. Reopened the saved policy to verify its email rule and duration.

Reused the existing **ksmc-retail** VPS tunnel, ID `4be1e02d-d8da-43ed-817d-cfe88ff7cdcc`. Added one route to `http://127.0.0.1:3017`, preserving the public Host. Cloudflared requires the Access assertion for the configured team and application audience. The backend independently verifies the assertion signature, issuer, audience, expiry and exact owner email. Existing `demo.sagoautomation.tech` routing and the final 404 remain intact. No new tunnel or connector was created.

Created one proxied CNAME for `shopbot-preview` pointing to that tunnel's `cfargotunnel.com` target. DNS record count increased from 21 to 22; other records were retained. Public resolver 1.1.1.1 now returns Cloudflare A records. This fixes the prior NXDOMAIN response. Cloudflare's [Access origin validation](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/origin-parameters/#access) and [configuration validation](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/local-management/configuration-file/) references informed the route checks.

## Activated release and backups

The VPS current link now points to **preview-91954be7da20**. Source commit: `989376a1cfb2205b7b7f620e99b067b8bc28db3b`; archive SHA-256 remains `93739ab23b9affa7089de4d9b3f7c16a373239190ef84b29e70778522db3c6b8`. The complete owner configuration maps the verified owner to the existing synthetic Workshop supply demo store. Mode remains mock; local AI, free inference and paid inference gates remain false.

Before changing the environment or tunnel configuration, copied their originals, the app service unit and previous release path into root-private **`/var/backups/shopbot-migration/publish-20261005T041829Z`**. The prepared upgrade script additionally backed up the configured environment and created a PostgreSQL custom-format dump under **`/var/backups/shopbot-migration/owner-20261005T041830Z`**; archive listing passed. This is not a full restoration drill. The previous native release remains available.

## Verification

- Readiness is 200; the new app and existing retail cloudflared service are active after an explicit app restart.
- Missing or forged owner assertions return 403 at the origin. The public Host blocks simulator and native-test endpoints with 404; unapproved Host returns 404.
- Cloudflare signing keys were reachable from the VPS. Tunnel ingress validation passed; rule checks selected the preview origin, retained old origin, and final 404 respectively.
- The signed-out browser reached **Log in to ShopBot owner preview**, then **Enter your code** after requesting email sign-in. Anonymous command-line HTTPS requests return 403 without dashboard data.
- App MemoryCurrent: **47,677,440 bytes**; MemoryMax: **402,653,184 bytes**. VM available memory: **420 MiB**; root disk free: **1.2 GiB**, 88% used. Persisted store pause/revision remained false/0 after restart.
- Sanitized VPS logs confirm authenticated `/api/owner/snapshot` and selected-conversation requests return 200. Both app and retail tunnel services remain active.
- Authenticated dashboard now loads as **admin.sagomedia@gmail.com** through the public HTTPS hostname. Conversations shows the existing synthetic shopper and preview response; Requests shows the correct empty state; Connections & usage shows WhatsApp not connected, customer sending disabled, AI disabled and paid inference disabled. No owner mutation was needed to verify these views.
- The user first saw a Chrome client block and then a 404 in their usual browser. Investigation found **two replicas on ksmc-retail**, including a desktop connector whose ingress contained only the legacy demo host and a final 404. The desktop connector could receive dashboard requests despite lacking its route. Stopped and disabled only the desktop user unit **ksmc-retail-tunnel.service** (config `/home/gk-pc/.cloudflared/ksmc_config.yml`); its files were retained. Cloudflare then showed **one healthy VPS replica**, IP 34.171.133.122. Reloading the existing signed-in Chrome tab loaded the dashboard and all three views successfully, without browser protection or Access changes. The separate desktop native-test tunnel stayed active/enabled.
- To avoid reintroducing intermittent 404s, keep the desktop retail unit disabled while this hostname uses the VPS tunnel. Re-enabling it requires first reviewing and synchronizing all ingress and Access validation rules; its old catch-all configuration is unsuitable for this dashboard. No new tunnel or connector was created.
- No verification code, authentication cookie or JWT was requested in chat or copied into this report. The initial Chrome block was not attributed to a specific extension, and no extension settings were inspected or changed.

Proof: [saved exact-email policy](021-cloudflare-owner-policy.png), [saved DNS route](021-cloudflare-dashboard-dns.png), [live sign-in page](021-dashboard-sign-in.png), [single VPS replica](021-retail-vps-only.png), [authenticated conversations](021-dashboard-conversations.png), [requests](021-dashboard-requests.png), [connections and usage](021-dashboard-connections.png).

## Remaining channel work

This release still has no live WhatsApp receiver, sender, manual replies or customer decision notifications. Connecting Meta requires implementing and testing the channel adapter, then validating the intended app/token asset permissions and publication restrictions, publishing an exact webhook route separately from interactive owner Access, configuring its challenge/signature verification and subscriptions, and running a controlled approved-recipient test. No Meta app, sender, token, subscription, paid service or customer send was changed during this publication.

## Temporary deployment access cleanup

Removed the one-off remote publication helper and removed the local temporary SSH private/public key files after verification. The original encrypted SSH key was unchanged. The temporary project metadata entry was issued with a one-hour expiry; it was not represented as manually revoked. Deployment backups and installed release files remain on the VPS.
