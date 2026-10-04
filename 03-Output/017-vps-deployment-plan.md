# ShopBot VPS migration plan — 4 October 2026

Deploy the current agent-based ShopBot on the Google Cloud VM, verify it privately, and then connect the intended WhatsApp sender through Cloudflare. The user selected a trial on the existing e2-micro: retain backups and old app files, then stop the two older services after the new release is healthy. The new application has not yet been uploaded. See `018-vps-native-preview-progress.md` for executed work.

The selected trial uses a compiled native release and systemd, rather than the development Docker image. It keeps the 1 GB machine and 10 GB disk unchanged. The release is 63,492,702 bytes compressed and 208,451,704 bytes unpacked; the native Debian PostgreSQL/FFmpeg installation completed successfully. Google Cloud's ongoing compute allowance covers the eligible e2-micro; changing to e2-small/e2-medium would be paid even for an India/INR billing account. Remaining account credits and actual billing have not been audited. [Free-tier rules](https://docs.cloud.google.com/free/docs/free-cloud-features#free-tier-usage-limits), [billing currencies](https://docs.cloud.google.com/billing/docs/resources/currency).

The full account/project/resource inventory is saved locally at `secrets/deployment/cloud-inventory.md`, which is ignored by Git. Keep actual credentials in their existing approved secret stores.

## Verified setup and deployment implications

| Resource | Finding | Implication |
| --- | --- | --- |
| Google Cloud VPS | sago-counter-ksmc, e2-micro, Debian 13; about 427 MiB available RAM and 3.0 GB free disk; swap already in use | Review a capacity increase before adding the app/PostgreSQL; build the image off the VPS |
| Previous application | ksmc-counter.service runs Python/uvicorn from /opt/ksmc-counter-assistant; configured Meta/WhatsApp fields | Preserve its SQLite data and existing credentials; validate token validity and sender identity before reuse |
| Existing native test application | sago-agent-native.service runs Python/uvicorn from /opt/sago-agent-native; AI and WhatsApp sends disabled | This is a separate existing implementation; the new Node/PostgreSQL ShopBot is not deployed there |
| Existing HTTPS route | demo.sagoautomation.tech → healthy ksmc-retail tunnel → localhost:8097 on the VM | Preserve it throughout the initial deployment |
| Existing native test route | native-test.sagoautomation.tech → sago-agent-native-test tunnel → localhost:8099 | Four existing path rules target an older interface, not this build's /native-test and /api/native-test routes |
| Native tunnel replicas | One VPS connector and one desktop connector | Do not use it as a VPS-only endpoint without resolving which origin receives requests |
| Cloudflare routes | Both bot tunnels are locally managed | Review host configuration files; DNS changes alone do not update their ingress rules |
| Current repository | Private sagomedia/agent-native-whatsapp-bot; GitHub main is an older snapshot | Freeze and verify the latest shared-workspace edits before exporting a release |
| Gemini | invisible-erp is on the free tier | Retain its persistent quota accounting and keep paid inference disabled |
| Current browser demo | Local-only host/origin checks and no owner login | First use an SSH tunnel; public hosting requires authenticated access and deliberate HTTPS/session handling |

Cloudflare Tunnel uses outbound connections, so the existing approach can publish selected HTTPS routes while the app/database stay on loopback. A static public IP is optional for this tunnel architecture. [Cloudflare Tunnel configuration](https://developers.cloudflare.com/tunnel/configuration/).

## Proposed order

### 1. Server inventory completed; finish WhatsApp identity and backup verification

Browser SSH inspection verified both Python services, ports, source directories, environment file locations, SQLite/media paths, remaining RAM/disk and both local tunnel configuration paths. Docker is not installed. The legacy environment contains Meta/WhatsApp Cloud credential fields; only field names and nonsecret mode flags were printed. Its credential validity, exact sender/app identity and backup restore capability remain to be verified before reuse.

The existing CLI key refresh was approved for one hour and applied, but the passphrase-protected private key could not authenticate noninteractively. The user then connected browser SSH successfully and the audit ran through that session. [Google SSH-in-browser](https://docs.cloud.google.com/compute/docs/connect/ssh-in-browser).

Verified credential locations: legacy /opt/ksmc-counter-assistant/.env; native test /etc/sago-agent-native.env. Legacy SQLite: /opt/ksmc-counter-assistant/data/enquiries.db. Native SQLite/media: /var/lib/sago-agent-native. Tunnel configs: /etc/cloudflared/config.yml and /etc/cloudflared-sago-agent-native/config.yml. Values stay in the existing approved stores.

Remaining deliverable: validate sender/token access and establish a restorable application backup. Observed pre-change SQLite copies and the GCP snapshot schedule have not been restore-tested.

### 2. Freeze a deployable source release

The shared source has newer Tamil and intent-discovery changes than GitHub main and this managed checkout. Preserve those edits, reconcile the checkout/Git working-tree pointer, create a reviewed release commit, run the existing build and regression suite, and record its image digest. Check the archive/build context excludes .env, keys, customer media, local databases and owner-only material that the hosted app does not need.

Build the runtime image on a machine with enough memory, using the pinned Node 22 setup and required ffmpeg. Supply the VPS an immutable release rather than an unversioned copy of the entire SMB workspace. Debian 13 is supported by the official Docker Engine installation flow. Inspect an existing Docker installation before changing packages. [Docker Debian installation](https://docs.docker.com/engine/install/debian/).

Deliverable: exact source commit, verified image, migration notes and a retained previous release.

### 3. Deploy a private VPS preview and switch the active services

Use the new `/opt/shopbot-vps` directory, separate PostgreSQL database and `/var/lib/shopbot-vps` media path, preserving both older services' files. Retain localhost bindings for app/PostgreSQL and a strong separate database credential. The native service has a 128 MB Node heap, a 384 MB service memory limit and reduced PostgreSQL memory settings. Build off the VPS. After readiness, synthetic reply and persistence checks pass on the VPS, stop and disable the two older services, then measure available RAM, swap, disk and actual service memory. Retain concrete rollback commands. A paid RAM upgrade remains an option only if measurements require it; no machine/disk resize or additional paid resource has been created.

Start with synthetic data. Use an SSH tunnel to localhost:3017 for the existing native-test UI. Keep its host/origin checks intact. Enable free inference only with the authorized project configuration; ALLOW_PAID_INFERENCE=false and AI_BUDGET_USD=0. A new independent database creates a separate quota ledger, so account for any other running applications using the same Gemini project.

Deliverable: healthy hosted app, successful Tamil/Tanglish text/photo/voice preview, explicit product/quantity/review consent and retained state after restart. Test migrations against disposable data; no mock reset or integration test should target the old merchant database.

### 4. Add the public channel and owner access

Choose an unused subdomain under sagoautomation.tech after reviewing current DNS/Access rules. Suggested names are shopbot-preview for authenticated owner access and shopbot-api for verified WhatsApp ingress; they are proposals, not existing routes.

Use a VPS-only tunnel/origin for the new service, or deliberately resolve the existing native tunnel's desktop/VPS replicas. Add authenticated HTTPS sessions and correct host/origin handling before sharing a browser preview. The Meta webhook needs its own publicly reachable verified endpoint and cannot be placed behind an interactive owner login. Publish only intended routes; keep the old demo and unrelated mail/lab records intact. Locally managed tunnel updates belong in the host configuration.

Deliverable: verified HTTPS endpoint that consistently reaches the intended VPS release, with separate owner access and webhook controls.

### 5. Connect WhatsApp, test, then switch deliberately

The legacy app has WhatsApp Cloud API configuration and a Meta Graph API sender. Validate its token, sender/app identifiers, permissions and webhook subscription before reusing authorized account resources. Place secrets directly in the approved server secret store; save only names/locations in deployment records.

Implement webhook challenge verification and raw-body signature checks, server-side customer/store identity, duplicate message handling, bounded media fetch, durable outbound delivery and delivery-status reconciliation. Connect these to the existing catalog/draft/consent services. The current repository does not yet provide that hosted channel. [Meta's archived SDK webhook reference](https://whatsapp.github.io/WhatsApp-Nodejs-SDK/api-reference/webhooks/start/) explains challenge/signature mechanics; use current platform documentation at implementation time rather than adopting the archived SDK.

Start with a test sender and explicitly authorized recipients. Verify text, Tamil/Tanglish, voice/photo, product choices, quantity correction, review/confirmation, retries, duplicate events and restart recovery. Recheck current messaging windows/templates/pricing for the actual sender; the local 50-paise planning estimate is not a confirmed tariff.

Before moving an existing sender, pause the old outbound consumer and switch webhook/routing in a controlled step so the same event does not cause two replies. Retain a concrete rollback to the old service/webhook, and reconcile events received during the switch.

Deliverable: one verified inbound-to-outbound WhatsApp conversation through the new app, with the old deployment retained for rollback.

## Intended architecture

```mermaid
flowchart LR
    Code[Verified ShopBot release] --> VM[New app on existing VPS]
    VM <--> DB[(Separate persistent PostgreSQL and media)]
    VM --> AI[Gemini invisible-erp]
    WA[Customer WhatsApp] <--> Meta[WhatsApp channel]
    Meta <--> Edge[Cloudflare HTTPS webhook]
    Edge <--> VM
    Owner[Owner browser] --> Access[Authenticated Cloudflare access]
    Access --> VM
    Old[Existing deterministic bot] --> Legacy[Existing demo and sender during validation]
```

## Deployment record

- Latest reviewed release commit/image digest: pending.
- Existing server services, source and data locations: verified in the private inventory; new deployment directory/port/Compose project still pending.
- Credential store/file locations and required key names: verified; values remain private and token validity remains untested.
- Old Meta sender/app identifiers and webhook subscription: pending targeted account validation.
- Capacity decision: native trial on the unchanged e2-micro; hosted app memory/disk measurements pending.
- VPS-only tunnel, selected subdomain and access policy: pending implementation.
- Database/media backup destination, restore test and rollback commands: pending.
- Hosted application / WhatsApp end-to-end verification: pending.

The initial inventory was read-only apart from the approved one-hour SSH key refresh. In the subsequent user-authorized deployment preparation, private legacy backups were created and verified, and Debian PostgreSQL/FFmpeg packages were installed. Both older apps remain running while the release upload is pending. No Docker installation, machine/disk resize, DNS/tunnel change, token rotation or customer message has occurred.
