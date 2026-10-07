# Customer Experience VPS Deployment

## Current Release

Sequential workflow update activated approximately 02:08 India time on 6 October 2026:

- Active `/opt/shopbot-vps/releases/preview-d385c6bec164`; previous `/opt/shopbot-vps/releases/preview-64e2a28156e0`.
- Archive SHA-256 `d412380e75c5acf836292a20a32c7a98b520922feb91564f7916bcfd5fee25db`; archive 6,220,138 bytes; staged content 8,383,542 bytes; free disk after staging 1,451,839,488 bytes.
- Verified private streamed backup `/var/backups/shopbot-migration/multimodal-20261005T203758205Z`.
- All 163 isolated PostgreSQL regressions and production build/typecheck passed. No new migration or dependency was added.

`WHATSAPP_SEQUENTIAL_ITEMS_ENABLED=true` enables a deterministic active-item queue: the first unfinished line controls product checks and missing quantity/unit questions before the next requested item appears. All requested lines and their amounts are retained. An absent first item is not skipped in favor of later available products; the customer can clarify, remove it or ask the shop. Initially exact complete lists retain grouped All correct acceptance, but after sequential selection begins later items stay one-at-a-time. Submitted-order proposals preview only the first category while preserving the whole proposal on Start this list or a verified product selection. Media recommendation facts focus on that first category. Final review shows product names, quantities, catalog units, unit prices and line totals, with separate final submission consent.

Tests cover three-line product/quantity progression with one initial interpretation, stale choices, absent-first-item removal, initial exact grouped confirmation, native WhatsApp Start this list and category advancement, known quantity preservation, immutable old requests and box/piece billing identity. The latter assertion was updated for the intentionally multiline bill rather than weakened. Selection/quantity/advancement uses no additional AI calls. Deployment did not replay any old customer request or perform paid inference. A fresh phone test with this exact version is still needed; isolated channel tests are not represented as actual customer taps or delivery.

Rollback restores the preceding `preview-64e2a28156e0` symlink and reviewed matching environment (disable the new sequential flag), retaining customer data and spending records. The unchanged $4.50 production/$0.50 evaluation application caps remain in force. Previous deployment notes below are historical.

Latest patch activated 6 October 2026 at approximately 01:57 India time:

- Active release `/opt/shopbot-vps/releases/preview-64e2a28156e0`; previous `preview-19d8309a4205`.
- Archive SHA-256 `46a1ecc47c16315a0063021d8fa79cf411f2cc7b1c4a2e713841df52e6c41417`; archive 6,219,639 bytes; staged content 8,380,553 bytes.
- Verified private backup `/var/backups/shopbot-migration/multimodal-20261005T202721835Z`; staged free disk 1,472,462,848 bytes. Readiness passed; environment gates and budget caps retained.
- All 159 isolated PostgreSQL tests and build/typecheck passed.

The customer reported typing indication without a reply to a fresh 10.92-second voice note. Scoped production records showed successful decoding, transcript and both identification/recommendation calls, followed by definitive Meta `131009` rejection. Payload inspection confirmed duplicate Start this list titles on two ambiguous PVC-pipe cards. The renderer now chooses shop handoff as the common secondary action when a card already uses Start this list, and validates unique titles within each card. Existing selection and consistent quick-reply counts remain intact.

A single audited recovery re-rendered the saved result and queued a new reply only after checking current version/binding, assistant mode, unpaused shop, open service window, no newer inbound message and a definitively failed original send without a provider ID. The original rejected outbox and all customer orders were preserved. No audio retransmission or new AI call was needed. Meta confirmed the corrected Tamil native carousel delivered, with distinct button titles and no delivery error. Production estimated committed spending remains $0.008939, held zero, cap $4.50; evaluation $0.019873 estimated plus $0.414516 unknown holds, cap $0.50. Recorded total estimates $0.028812, not an invoice/account balance. The transcript contains two PVC-pipe amounts; whether this is an intended pair of lines or spoken correction still requires customer clarification and must not be silently merged.

Rollback for this patch restores the preceding `preview-19d8309a4205` symlink and reviewed matching environment, retaining the live database/budget ledger. Older deployment evidence below is historical.

Activated 6 October 2026 at approximately 01:42 India time on the existing VPS.

- Active release: `/opt/shopbot-vps/releases/preview-19d8309a4205`.
- Previous release: `/opt/shopbot-vps/releases/preview-e200cb77911d`.
- Archive SHA-256: `50086242a24da0dcb397c900270ae680161d00068a746525aeea4c5914db2571`.
- Archive 6,219,269 bytes; staged content 8,380,021 bytes; free disk after staging 1,503,338,496 bytes.
- Verified streamed private database/environment backup: `/var/backups/shopbot-migration/multimodal-20261005T201250655Z`.
- Schema 19, readiness, assistant mode, Tamil preference, unpaused shop/unblocked sender, public catalog photo and privacy checks passed.
- All 158 isolated PostgreSQL regressions and production build/typecheck passed.

Media-only recommendation staging is now enabled by `WHATSAPP_MEDIA_RECOMMENDATION_ENABLED=true`; global text discovery staging remains disabled. Recognition excludes inventory suggestions, then the compact agent step receives only the recognized request and fresh matching facts, not the taxonomy. It chooses one question and up to four actual SKUs without quantity writes, product consent or final submission. New multi-item follow-ups show real product previews immediately. Choosing one photo starts every proposed line and confirms only the chosen product; stale/duplicate taps preserve the current list. Start this list remains a second native carousel button. Unknown amounts and previous immutable requests are retained.

Voice decoding has a 20-second deadline with one decoder/filter thread and unchanged 30-second/1 MB limits. Audio inference has 19/20-second SDK/runtime limits in a 45-second work lease; recommendation remains bounded to 9.5/10 seconds. No hidden model retries, local STT/model or TTS were added. Failed attachments show one localized line plus bound browsing/handoff controls. Provider failures retain safe HTTP/timeout codes. Spoken English number-word dimensions normalize to strict numeric catalog constraints without supplying a purchase quantity.

Latest real media evidence: the customer's 8.78-second recording, received 5 October at 19:36:35 UTC, originally failed decoding before any model attempt. It was fetched privately via the Meta media API. A short-deadline isolated test failed and retained a $0.029901 unknown-cost hold; the repaired bounded check passed. The final isolated two-stage evaluation recognized a one-inch pipe plus one blade, with pipe amount unknown and blade amount one; asked about available pipe brands; and showed H01/H02 pipes plus H16 hacksaw blade/H14 cutting-wheel alternatives. Its two calls cost an estimated $0.001333 and sent no WhatsApp messages or new order requests.

One audited customer-authorized replay used a new idempotent message ID linked to the original recording. It required successful isolated recognition, unchanged source version, current assistant mode, open service window, no newer queued customer message and zero original provider attempts. Original failed media/fallback records, history and prior submitted requests were preserved. The live replay's identification and recommendation both succeeded; Meta confirmed one Tamil interactive carousel delivered with the pipe-brand question above four photos. Estimated live replay cost: $0.001278. No live customer selection or final submission was fabricated; product selection and list-preservation progression are verified separately by channel tests.

Current cumulative application ledgers: production $0.007370 estimated committed, $0 held, not blocked, cap $4.50; retained evaluation $0.019873 estimated committed and $0.414516 unknown-cost holds, cap $0.50. Total recorded estimated charges: $0.027243, plus conservative unknown holds. These are not a Google account balance or invoice. Caps, prior failed records and unknown reservations were never reset.

For rollback, atomically restore the previous `preview-e200cb77911d` symlink and reviewed environment from the verified backup, restart the service and verify readiness. Keep current customer data and ledgers; never restore an old database automatically after receiving new messages. The previous release does not use media-only recommendations. Broader noisy-audio/technician vocabulary accuracy, clarification-loop metrics, merchant stock/unit/price verification, attachment retention/deletion and fulfillment remain future work.

## Previous Deployment

Final activation 6 October 2026, approximately 00:51 India time (backup timestamp is UTC), on the existing `sago-counter-ksmc` instance, project `hermes-mcp-test`, zone `us-central1-a`. The voice/multi-item follow-up fix was activated first at approximately 00:38; the final release adds the real-photo corrections.

- Active release: `/opt/shopbot-vps/releases/preview-e200cb77911d`.
- Previous release: `/opt/shopbot-vps/releases/preview-bd74311ac563`.
- Archive SHA-256: `71ef34ece369147170cae7115a5f23bf6f5a120b780715b3d974a53abe49075e`.
- Archive: 6,217,133 bytes; staged content: 8,371,008 bytes. Disk free after staging, before cleanup: 1,100,390,400 bytes.
- Verified private pre-change database/environment backup: `/var/backups/shopbot-migration/multimodal-20261005T192105834Z`.
- Voice/multi-item activation backup: `/var/backups/shopbot-migration/multimodal-20261005T190846389Z`; previous voice release backup: `/var/backups/shopbot-migration/multimodal-20261005T184542993Z`.
- Earlier initial paid-media activation backup: `/var/backups/shopbot-migration/multimodal-20261005T180505032Z`.
- Schema version 19; systemd `shopbot-vps.service`; loopback `127.0.0.1:3017`.

The activation helper now streams `pg_dump` into a mode-0600 file rather than buffering recordings in memory. Two preceding activation attempts stopped during backup with `ENOBUFS` before changing the service; they were not successful releases. The final streamed backup was checked with `pg_restore --list`, activation succeeded and readiness passed.

Guarded cleanup removed only the never-activated intermediate stages `preview-b55be665b96b`, `preview-59bfc98bc2ce` and `preview-23014869f647` and their verified temporary archives. Active and backup-referenced releases, all private backups, customer data and ledgers were preserved. Reclaimed 35,377,152 bytes; final free disk 1,129,283,584 bytes. Attachment retention and continued disk monitoring are still needed as message volume grows.

## Verified Behavior

All 153 isolated PostgreSQL regressions and production build/typecheck passed. Coverage includes old submitted context exclusion, read-only response normalization, separate image/recommendation contracts, media error redaction, one-tap multi-item new-list staging, stale buttons, nail-versus-screw mismatch, and supported versus invented photo filter keys. Desktop 1440px and mobile 390px browser checks covered Tamil/Tanglish, product photos, More options menus, editing and owner reply layouts, with no horizontal overflow or JavaScript errors. Tamil font rendering was visually checked. Local preview remains offline/mock at `http://127.0.0.1:3041/native-test`; it does not call Gemini or Meta and intentionally disables real photo/voice interpretation.

Final VPS audit confirmed: schema 19, HTTP readiness, production paid budget unchanged, audio/photo support, media and typing enabled, second recommendation stage disabled, Tamil reply preference, assistant mode, shop pause off and channel send-block off. Public HTTPS catalog photo returned 200 `image/jpeg`; published privacy discloses private normalized attachments sent to Google. The audit itself made zero AI calls and zero WhatsApp sends. Overall readiness reports `mode=mock` because the simulator stays mock; the WhatsApp adapter has its separately verified paid configuration.

The allowlisted test conversation had shop-owner takeover active. Only after explicit user approval was it resumed with audited owner-control semantics, revision increment, stale queued reply cancellation, and preserved history/drafts/immutable submitted requests. Signed Meta callbacks confirmed delivered Tamil text and product-choice replies after resume.

## Real Model Evidence

The initial seven small real Gemini text/photo cases passed: Tamil pipe-cutter request, Tanglish typo screwdriver without fabricated inventory, Tanglish two-item quantities, absent paint preserved unresolved, and cutter/blade photos including a fresh blade test after strict inch normalization. Estimated cumulative cost before human voice work: $0.005657. This is a small smoke evaluation, not calibrated production accuracy.

The customer's real 13.14-second WhatsApp voice note arrived. Its first attachment download failed generically, then privately downloaded/decoded successfully on diagnostic retry. The initial live recovery produced two billable invalid responses without transcripts. Failed attempt records and cost settlement were retained; recovery did not delete the customer history or reset spending. An already-existing fallback reply prevented a second reply receipt for that recovered message; its exhausted processing state was closed in a scoped audited operation.

Native expanded-schema voice trials were rejected; production continues JSON mode with a dedicated audible-speech instruction and strict mandatory-transcript/backend operation validation. No local STT/model or TTS was added. Removing catalog/taxonomy suggestions from voice recognition prevented stock from biasing the spoken product identity.

The earlier isolated recording retest passed in one call: transcript recognized two cutters and four saws for cutting wood; quantities 2 and 4 were retained. The absent whole wood saw remained unresolved rather than becoming a hacksaw blade. Prompt 1,331 tokens, output 88, estimated cost $0.000620.

Fresh production voice messages then exposed a submitted-line edit with an inherited quantity and an invalid multi-item response. Meta confirmed their replies delivered, including fallback/rejection replies; delivery was not mistaken for correct recognition. A fresh 6.22-second saved-recording check now retains two blades and a one-inch pipe, with blade quantity two and pipe quantity unknown. The 6.74-second recording now retains one blade for cutting metal, not the old submitted quantity two. Old order/draft snapshots remain unchanged. Their final successful checks cost an estimated $0.000680 and $0.000744, respectively, with one call each and no WhatsApp sends or new customer submissions. Multi-item proposals enter ordinary product/quantity checking through one bound Start this list button, not another typed message.

The customer photo arrived at 18:57:51 UTC and its Tamil interactive reply was confirmed delivered. Recognition named a nail but incorrectly forced the screw-box family. The final image adapter excludes product/taxonomy suggestions and discards guessed family/department filters. It supplies only supported specification-key names; unknown label attributes become keywords, rather than SQL filters for nonexistent fields. The intermediate blade retest exposed an invented material filter that hid H16; the new regression covers that failure while preserving the supported 12-inch size constraint. All final photo checks passed: actual nail with zero fabricated matches ($0.000674), cutter H19 ($0.000879), blade H16 ($0.000729). These isolated evaluations made zero WhatsApp sends and no new customer requests. A fresh phone message after this final release is still necessary to verify its exact end-to-end reply.

## Budget And Controls

The user authorized up to $5 on the existing paid Google AI Studio key. No keys were copied into release bundles or printed.

```dotenv
ALLOW_FREE_INFERENCE=false
ALLOW_PAID_INFERENCE=true
AI_BUDGET_USD=4.5
ALLOW_MULTIMODAL_INFERENCE=true
ALLOW_LOCAL_AI_TEST=false
WHATSAPP_MEDIA_ENABLED=true
WHATSAPP_TYPING_ENABLED=true
WHATSAPP_DISCOVERY_STAGES_ENABLED=false
WHATSAPP_DEFAULT_LANGUAGE=ta
```

The production cumulative application cap is $4.50 and evaluation cap $0.50 in retained schema `customer_eval_20261005`. Existing ledger limits and spent/held amounts were preserved throughout, including unsuccessful intermediate checks. Final production audit: estimated committed $0.006092, held $0.00, not blocked. Evaluation: estimated committed $0.017608, unknown-cost held $0.384615. Total recorded estimated charges across both are $0.023700, plus those conservative holds. Unknown reservations are not verified charges, and no provider invoice/account balance was checked. Other applications using the same key are outside these application caps.

One identification call is the default. Selection, refinement, quantities, review, language change, edit and handoff use deterministic controls. Discovery offers up to four useful actual choices; multi-item confirmation preserves all line groups. No fake options are added to fill a carousel. The demo inventory has no screwdriver, paint or complete wood saw listing. Photos are candidate suggestions, not exact visual identity guarantees. Attachment retry is bounded to one transient network/5xx retry per stage; no retry for authorization/rate-limit errors, unsafe hosts or oversized input. Media lease is 75 seconds; bytes remain private.

## Rollback

For the immediately previous paid-media release, atomically restore `/opt/shopbot-vps/current` to `/opt/shopbot-vps/releases/preview-bd74311ac563`, retain the current database and budgets, restart `shopbot-vps.service`, and verify readiness. If restoring its exact environment is necessary, use the final private backup after reviewing current controls. This previous release has the voice/multi-item fix but lacks the final photo guard.

For older free-only releases, restore their matching reviewed environment along with code: they may reject paid-media flags. Keep AI/media disabled until their authorization/budget behavior is reviewed. Migration 19 is additive; old code can ignore its extra field. Never automatically restore an old database after receiving new customer messages, because that could discard messages, requests and billed attempts. Preserve backups and unknown-cost holds for explicit reconciliation.

## Remaining Work

Fresh allowlisted phone delivery and recognition with the exact final release; larger technician vocabulary and noisy-audio evaluations; real merchant stock/unit/price verification and sync; attachment retention/deletion; clarification-loop metrics and escalation; additional complete-tool versus replacement-part evaluation; approved out-of-window templates/Flows where supported; payment and fulfillment. The small passing smoke set is not a calibrated production-accuracy claim. Earlier media decode failures remain recorded; their exact cause was not established, and the final code adds safe differentiated decoder errors rather than assuming it is fixed.

Primary references: [Gemini audio](https://ai.google.dev/gemini-api/docs/audio), [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing), [Meta interactive messages](https://whatsapp.github.io/WhatsApp-Nodejs-SDK/api-reference/messages/interactive/) and [Meta Cloud API collection](https://www.postman.com/meta/whatsapp-business-platform/documentation/wlk6lh4/whatsapp-cloud-api).
