# ShopBot maintenance and customer rollout playbook

_Proposed operating plan · 21 November 2026_

## The decision

**One ShopBot codebase. One release build. A separate configuration and data boundary for each shop.** A hardware shop and a grocery shop should run the same shopping engine. Their inventories, units, languages, branding, phone numbers and operating policies supply the differences.

Keep the current Node/Fastify, React and PostgreSQL stack on the Google VPS for the first pilots. Give the next pilot an isolated runtime, database, media path, secrets and WhatsApp connection. Keep the same build for both shops. Move to a shared runtime only after implementing and testing how requests, jobs and owner sessions resolve the correct store.

Today, PostgreSQL records and retail operations are scoped by store. The running application still takes one owner store and one WhatsApp store/sender from its environment. The native VPS scripts also have fixed service, database, port and release paths. That makes a shared codebase possible now and makes concurrent customer provisioning a small engineering task. For the first new customer, use a separate VM if the current server serves a real shop. If VM cost is decisive, first parameterize and rehearse separate instances on one VM with independent ports, service users, DB roles, data paths and verified ingress. A shared VM also shares CPU, disk and outage risk. [Owner config](02-Build/shopbot-ai/apps/server/src/config.ts) · [WhatsApp config](02-Build/shopbot-ai/apps/server/src/services/whatsapp-config.ts) · [Current VPS upgrade script](02-Build/shopbot-ai/deploy/native/upgrade.sh)

~~~mermaid
flowchart LR
    A["Issue + example"] --> B["Short branch in the main checkout"]
    B --> C["Local test + GitHub CI"]
    C --> D["Merge to main + build release"]
    D --> E["Rehearse with synthetic data"]
    E --> F["Pilot on an authorized shop"]
    F --> G["Promote the same build to approved shops"]
    F --> H["Pause or restore compatible app release"]
    B --> X["Experiment with separate data and no customer sends"]
    X --> C
~~~

## What stays shared and what varies

| Layer | Owns | Example |
|---|---|---|
| **Commerce core** | Catalog retrieval, typed cart edits, quantities, order state, billing, stock policy enforcement, retries and idempotency | A stale WhatsApp tap cannot place an order twice. |
| **Shop data and settings** | Catalog, photos, aliases, selling units, shop identity and hours, enabled workflows, verified invoice details | A hardware shop sells a coil as a pack. A grocery shop sells rice by the kilogram. |
| **Adapters** | WhatsApp, Gemini, dashboard, bill rendering and future provider integrations through tested interfaces | A speech-model experiment can change transcription without changing the meaning of a cart operation. |
| **Deployment configuration** | Secret references, sender and owner bindings, domains, DB/media locations, enabled features and approved spend | Two shops can run the same release SHA with separate credentials and customer records. |

ShopBot’s shared shopping flow is **text, voice or photo → typed shopping intent → SQL inventory matches → real product photo choices → cart review → explicit submission**. Gemini interprets the request. The backend owns product IDs, selling units, price, stock, totals and consent. Keep one real match as one product card. Use carousels for several relevant matches and inventory-backed filters for broad searches. Preserve the full list after an edit, including requests the shop needs to check. Repeatable button actions use saved state. A shop-specific keyword rule belongs in reviewed catalog data or a general search improvement that works across shops. [Product rules](WORKING-PREFERENCES.md) · [Agent handoff](AGENT-HANDOFF.md) · [Catalog discovery](02-Build/shopbot-ai/CATALOG-DISCOVERY.md)

Shop hours and catalog data already have app workflows. Add validated shop settings gradually for recurring requests such as branding or invoice layout. Keep new settings optional with explicit defaults. When a workflow genuinely differs, give the shared core a tested extension point. A custom PDF template may format bill data, while saved order lines and totals remain common.

Start with a private deployment record per shop. It can be a short Markdown file in an approved private location. Include what another operator needs to verify the target:

| Record | Fill in before activation |
|---|---|
| Shop | Shop slug and store ID, owner contact, owner hostname and locale |
| Runtime | GCP project and VM, service, expected port, database name, media location, environment file path |
| Channel | Webhook hostname/path, sender and WABA identifiers, approved pilot recipient reference, secret-store references |
| Release | Git commit, verified artifact fingerprint, package checksum, schema version, feature flags, previous release |
| Operations | Who can approve go-live, backup/restore evidence, approved inference budget and who responds to failures |

Keep token values, customer recordings and customer order data out of Git and AI handoffs. This record is documentation today. A future provisioning command can validate its non-secret fields and generate service configuration when the second onboarding reveals which steps repeat.

## Daily planning and AI changes

Use existing **GitHub Issues → branch → PR → deployed evidence** as the first tracking system. Keep it sequential: **Ready → In progress → In review → Pilot → Done**. A merge puts the change in source. A pilot release runs on an approved test shop. A promotion moves the tested build to a named customer. Done means the agreed behavior works on the target. If the team later adopts Linear, keep the task there and link its PR and release evidence once.

Use this five-line issue template.

~~~text
Customer or owner problem:
One example that fails today:
What must still work:
Acceptance check and target:
Rollout and rollback:
~~~

Work from the prepared checkout in [LOCAL-DEVELOPMENT.md](LOCAL-DEVELOPMENT.md). Inspect the current branch, remote status and working tree before creating a short-lived branch. Preserve unpublished changes. Use one checkout and the actual local dashboard when testing UI changes. Record the tested commit. Require the existing GitHub build and PostgreSQL test check on main where branch protection is available. Keep production activation an explicit operator action until customer onboarding and rollback are repeatable. [.github/workflows/project-checks.yml](.github/workflows/project-checks.yml) · [GitHub required status checks](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)

From the app directory on the prepared machine:

~~~bash
npm run local:db -- start
npm run build
npm run test:local
~~~

Use `npm ci` for a fresh checkout or a changed lockfile. Add a focused regression case when fixing a specific failure. For shopping changes, verify SKU identity and actual photo, quantity and unit, unrelated cart items, explicit submission and dashboard order creation. For pickup changes, verify saved totals agree across dashboard, reviewed bill and pickup invoice. Use GitHub CI for the full checks. If testing real WhatsApp, use the existing local guide. The current local helper temporarily redirects the existing number, so coordinate it with the shop and restore VPS routing before deployment. A separate pilot number is preferable for repeated experiments. [Local and phone tests](LOCAL-DEVELOPMENT.md) · [Existing test scenarios](02-Build/shopbot-ai/CUSTOMER-AND-OWNER-TEST-PROMPTS.md)

### Experiments

Use a short-lived branch and a disposable database for big changes to model, prompt, search, storage or hosting. Write down a baseline commit, what you expect to improve, and which results would cause you to stop. Replay the same consented or synthetic cases against both versions. Compare correct SKU in the displayed set, wrong-variant selections, successful completion, p95 reply time and cost per completed order. Include Tamil and mixed-language voice, photos, broad searches and one-turn replacements. For search work, use a dense real-like inventory with overlapping variants at 3,000 products or more.

Keep customer sends disabled during development. A shadow run on authorized inputs may log the proposed result privately. It must never edit the active cart, write stock, send messages or affect payment. Promote one change at a time. Start with an internal shop or pilot, retain the previous behavior behind one scoped switch where practical, and schedule removal of the switch once the outcome is known. Evaluate prompt and model changes as releases, with a named baseline and saved results.

For migrations, add the new schema first, keep both app versions compatible during transition, and rehearse on a populated disposable restore. Move data in a separate rerunnable step and verify it before removing old fields in a later release. Check ongoing workers, old WhatsApp buttons, stock reservations and bill revision history as well as startup.

## Deploy one customer, in this order

1. **Agree on scope.** Record who owns the number and Meta account, who reviews stock and prices, who approves the launch, and what support and data recovery the shop needs. Decide which features the pilot includes. Use the shop’s test sender or authorized test recipients for acceptance. Check the shop’s privacy notice, how customers reach a human, and how it handles opt-in and approved message templates before expanding the audience. [WhatsApp Business Messaging Policy](https://whatsappbusiness.com/policy/)
2. **Prepare the target.** For a new shop, create independent credentials and storage. Bind the owner login, WhatsApp sender and webhook to the same verified store. Keep Postgres and the app on private interfaces, route HTTPS through the established ingress, and restrict owner access. For the existing VPS, identify the host, current service, active release, schema, spare disk space and whether the local WhatsApp test route is active. Resolve any routing mismatch before the switch. The current installer and upgrade scripts target the existing fixed layout, so verify or adapt the provisioning scripts before running them on a new target. [VPS guide](02-Build/shopbot-ai/deploy/native/README.md)
3. **Validate the catalog.** Get merchant-approved names, sizes, selling units and increments, prices, stock policy and photos. Check duplicate aliases and confusing variants. From the app directory, run `npm run catalog:stage -- /absolute/package/path` to validate without writes. Prepare the approval list for draft import. Apply it in step 6 once the target database and schema are ready. [Catalog intake guide](02-Build/shopbot-ai/deploy/native/RELEASE-CHECKS.md)
4. **Build once from a clean reviewed commit.** Record the commit SHA and CI result. From the application directory, run `npm run release:manifest`. Package with `deploy/native/package-release.py` and record its archive SHA-256. Use `--reuse-release` only with a verified matching runtime and dependencies already installed on that target. Use the full checksum-verified runtime bundle for a fresh target. Stage the bundle and rehearse on a disposable database before production activation. The full package and staging steps are in the [native deployment guide](02-Build/shopbot-ai/deploy/native/README.md).
5. **Verify recovery before switching.** Identify the previous artifact. Take and verify a private database backup and preserve the matching media and configuration. Keep a recoverable copy outside the VPS. Record the backup location, time and recent restore drill. Check that the previous app can run with the candidate schema and still respect current orders and stock. Set a maintenance window if restart or recovery could interrupt the shop.
6. **Activate the release.** For the existing service, use the staged release’s `deploy/upgrade.sh` workflow from the native guide. On the current VPS, verify `systemctl is-active shopbot-vps.service` and query the loopback `/health/ready` endpoint on port 3017. Check the authenticated `/api/owner/release` response for the expected fingerprint and feature flags. For a new shop, keep processing and sends off during provisioning. Confirm the migrated database and store binding, run the scoped catalog import and approve the drafts in Products. Spot-check common products and rare variants. Verify webhook routing for its sender, then enable the configured pilot audience. [Existing VPS upgrade workflow](02-Build/shopbot-ai/deploy/native/README.md)
7. **Prove one full order before wider use.** From the authorized phone, ask for a product by text and voice or photo. Verify the actual photo and variant, make an edit, review and send to the shop once. In the owner dashboard, verify the correct shop receives the request, mark it ready, and check bill delivery status. Record pickup on the test order and verify that the invoice total equals the saved order total. Use a merchant-approved test item or isolated stock. Check a separate test that a shop owner and one sender cannot read or operate another shop’s catalog, orders, media or queue. Readiness, provider acceptance and phone delivery each need their own evidence.
8. **Watch and sign off.** Record host, shop, fingerprint, deploy time, migration, backup, checks and named owner. During the pilot, watch failed or delayed jobs, unknown sends, inference spend and dashboard availability. Duplicate orders, incorrect totals or cross-shop access require an immediate pause. Resume after the records and customer impact are understood and the repair is verified.

On the existing VPS, these read-only checks identify the running service and release and show available disk. Run them before staging and again after activation, then compare the fingerprint in the authenticated owner view.

~~~bash
hostname
systemctl is-active shopbot-vps.service
readlink -f /opt/shopbot-vps/current
df -h /opt/shopbot-vps
curl -fsS --max-time 5 http://127.0.0.1:3017/health/ready
~~~

**If the release fails:** Preserve the inbox, outbox, customer records and logs. Pause the affected shop’s processing or sending as appropriate, then restore the previous *compatible* app artifact or fix forward. The upgrade script’s readiness fallback changes the app symlink and leaves the database in its current state. The repository’s `rollback.sh` is for restoring older legacy services. Use the compatible release and data recovery approach above for the connected ShopBot. For data recovery, restore into a separate database first, measure what would be lost and reconcile activity since the backup before approving a cutover. Confirm the selected runtime and webhook after recovery. [Upgrade behavior](02-Build/shopbot-ai/deploy/native/upgrade.sh) · [Legacy rollback script](02-Build/shopbot-ai/deploy/native/rollback.sh)

## Hosting choices when usage changes

| Situation | Choice | What to check |
|---|---|---|
| First pilots, small team | Keep native systemd and PostgreSQL. Build off-server and reuse release packages. Share code and keep deployments isolated. | Worker queue age, RAM/swap, free disk, database backup time and monthly cost per shop. |
| New setups are taking too long | Automate provisioning and preflight from the same shop record. Start with a small script and GitHub Action once the manual process works for a second shop. | Re-run onboarding safely, detect target mismatch before writes, and leave releases and logs traceable. |
| Database recovery dominates support | Compare managed PostgreSQL and storage against the time and cost of self-hosting. Test restore and recovery time before moving. | Backup retention, point-in-time recovery, connections, media storage and region. [Cloud SQL recovery](https://docs.cloud.google.com/sql/docs/postgres/backup-recovery/restore) |
| Independent webhook and worker scale becomes necessary | Assess moving the web process and job workers separately. Keep PostgreSQL as the source of truth. | Queue leases and duplicate delivery, per-store limits, connection pools and graceful shutdown. A default request-based Cloud Run service cannot be assumed to keep polling after an HTTP response. Decide how the workers stay active before migration. [Cloud Run background processing](https://docs.cloud.google.com/run/docs/configuring/billing-settings) |
| Running many isolated instances becomes costly | Build shared multistore routing from the verified sender and owner account. Enable it for a pilot cohort first. | Cross-shop isolation in SQL, caches, media, jobs, backups, admin tools, rate limits and per-merchant spend. |

Start with a small dashboard or weekly report for **oldest pending inbound/outbound job, reply success and p95 latency, send outcome, Gemini spend/holds, disk free, last successful backup and last tested restore**. Keep timings for SQL, Gemini and queue wait separate so a slow answer has an owner and a cause. Keep logs searchable by shop, release and internal conversation ID. Agree on how much recent data each shop can afford to lose and how long it can operate without ShopBot. Use those answers to set backup frequency and run a restore drill. GitHub can rebuild the app and its history. The database and media recovery process restores the shop’s work. [Local data boundaries](LOCAL-DEVELOPMENT.md) · [Restore rehearsal](02-Build/shopbot-ai/deploy/native/RELEASE-CHECKS.md#backup-and-pilot-evidence)

**Fast and sound:** A short shell command for a repeatable release step, one Markdown checklist, and an operator checking a real phone are enough for early pilots. Upgrade a shortcut to a script once repetition makes errors likely. Spend engineering time first on preventing duplicate sends, preserving order data and confirming the right store served the right product.

## What to build next

1. **Establish a repeatable baseline.** Reconcile local, GitHub and VPS release IDs. Fix the known exact-name search regression where an inferred brand hides a unique catalog name. Keep a baseline for a dense catalog and full WhatsApp order. Verify off-VPS recovery of database, media and configuration.
2. **Onboard one more shop from the same code.** Use a separate customer boundary, reviewed catalog and test recipient. Run the checklist end to end and record where setup was manual or error-prone.
3. **Automate the repeated parts.** Parameterize target validation, service/database/media paths, staging, health and release reporting. Add a release command that reports the target, changes and recovery path before activation. Reuse the verified artifact across customers. Keep a named operator responsible for production activation.
4. **Experiment with evidence.** Take one measured problem such as exact-match rate, voice correction or reply latency. Compare results against the baseline in isolation. Move to shared multistore hosting only when there is an operating reason and the isolation tests pass.

## Learn by running four drills

- **Release and undo.** On a disposable instance, deploy two tagged builds in sequence. Recover the first compatible build, then confirm the second build’s saved test order remains accessible. Learn the difference between source, running release and database schema.
- **Find one slow reply.** Follow a synthetic WhatsApp order through inbox, worker, Gemini, SQL, outbox and delivery. Time each part before deciding whether to optimize a query, a prompt or the VM.
- **Restore and measure.** Restore a database and its matching media on another instance. Check that a product photo and a saved invoice still resolve. Record how long it took and how much recent activity the recovered data omitted.
- **Onboard a contrasting catalog.** Use a small grocery fixture beside the hardware fixture. Test a measured quantity and a pack sale through the same code. Use the result to decide which differences belong in catalog data, shop settings or a shared extension.

## Copy this into a new AI session

~~~text
Work in ShopBot's canonical local checkout from LOCAL-DEVELOPMENT.md.
Read AGENT-HANDOFF.md, WORKING-PREFERENCES.md and SHOPBOT-OPERATIONS.md.
Task: [change or release]. Target: [local / test shop / named VPS shop].
Expected behavior: [one input and verifiable result].
Start by reporting the checkout, branch, intended app commit and target route.
Preserve pending edits. Reuse shared services and store-specific settings.
Keep the inventory-driven product photos/carousels, cart edits, order consent,
and shop data boundaries intact. Verify the affected workflow.
For a release, validate DB/store binding and webhook routing, confirm the reviewed
artifact and recovery path, and verify the resulting fingerprint. Read credentials
from their approved private location without displaying them. Report separately
what passed locally, on the VPS, and on the authorized phone. If production
activation or external sending is outside this task, stop at verified staging.
~~~
