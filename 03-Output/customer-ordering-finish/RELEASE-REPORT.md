# Deployment handoff — 16 October 2026

The guided checkout repair is deployed on the existing VPS. The actual customer's paint query now retrieves the matching catalog photo despite the Tamil spelling difference and the litre/kg mismatch. The bot asks the customer to choose the real pack; it does not convert litres to kilograms or silently select a different paint.

| Item | Verified value |
| --- | --- |
| Active release | `preview-27f9774fb582` |
| Runtime source commit | `531bc3ae50eae3200363af82140adb3ad84ac690` |
| Artifact SHA-256 | `5ebc75c1c61fa8e480398391ee9cc13e12768e9e6c3bf25336224e70d67cc48b` |
| Source branch | `codex/finish-customer-ordering-20261015` |
| Database migration | 34; additive changes to order advances |
| Prompt version / understanding schema | `2026-10-15.4` / 2 |
| Runtime verification | 133 content-verified artifact files |
| Integration tests | 536 passed; 0 failed or skipped |
| Build | TypeScript check, production build and clean-source release build passed |
| Service | active/running; 0 automatic restarts |
| Model | Existing `gemini-3.5-flash-lite` configuration retained |
| Demo payment | `UPI_DEMO_PAY_AT_SHOP_ENABLED=true`; actual receipt verification remains manual |

## Customer flow

1. A Tamil voice note, text or photo proposes items. Inventory checks retain the product identity, dimensions and original requested count. Real product photos guide explicit choices.
2. Product cards offer selection and editing. Routine shopping does not repeatedly push the customer toward human help.
3. The final product check offers **சரி, Bill காட்டு**. The estimated invoice includes the full item list, spaced text and invoice images. Products needing a price remain visible with a dash; only known prices contribute to the subtotal.
4. **கடைக்கு அனுப்பு** explicitly creates one order in the owner's Requests. Asking for an estimate or human help alone does not submit it. Ordinary Tamil such as **சரி பேக் பண்ணுங்க** can open checkout without creating an order implicitly.
5. The bot offers the ₹10 QR once automatically. In this demo **கடைல பணம் தர்றேன்** lets the customer continue and pay the full bill at the shop. The stored state is unpaid: `pay_at_shop`, `payment=not_requested`, `advance_required=false`. Neither the customer nor the owner is told that an advance was received.
6. The owner checks unresolved items, supplies a quote if needed, accepts and prepares the order, and marks it ready and collected. Status questions and legitimate amendments remain actionable after ordering; a simple thanks can be silent. Asking for a bill after submission does not start a second checkout.

The default production configuration keeps the advance gate. A customer saying they paid is only a claim. Actual ₹10 receipt requires the authenticated owner to check their bank/UPI app and record its real transaction reference. The existing refund and duplicate-reference controls remain.

## Actual inventory check

A transaction against the real customer cart retrieved `SHOP-3DB752A98B9B41BF`, Asian Paints Tractor Uno Acrylic Distemper 10 kg, for the original 10 litre request. Its actual catalog photo is available and returns HTTP 200 (`image/jpeg`, 19,030 bytes). No SKU was selected automatically. The transaction was rolled back, and the customer's draft version and hash remained unchanged. No model call or WhatsApp message was needed for this check.

The inventory record itself has an inconsistent selling basis: its name/specification says 10 kg while its selling unit is litre and is unverified. The bot preserves the requested one-container count and excludes this product's unverified price until the shop checks it. Inventory data was not rewritten to manufacture a match or price.

The earlier audio corrections remain included. The measured decoder/provider investigation and historical playback repair are in [AUDIO-INCIDENT.md](AUDIO-INCIDENT.md). No fresh bank settlement or live customer voice-transcription accuracy is claimed by the checkout diagnostics.

## Evidence and preserved records

- [Checkout test summary](evidence/checkout-test-summary.json) and [full integration results](evidence/checkout-integration-tests.log).
- [Deployment, actual inventory and preservation proof](evidence/checkout-deployment-proof.json).
- [Invoice appearance](evidence/checkout-invoice.png), generated using a synthetic fixture with one known-price and one unpriced item. Its displayed paint price is fixture data, not a price verification of the real inventory record.
- [Root causes and deterministic/agent flow diagram](CHECKOUT-REPAIR.md).

Hashes confirmed that all three existing orders, advances, amendments, quotes, customer drafts and handling controls, inference budgets and inventory rows were unchanged by activation. The $4.50 inference ceiling and existing unknown usage holds were retained. The deployment did not send a customer WhatsApp test message or perform a bank payment.

Final checks: native readiness HTTP 200, welcome audio HTTP 200 (`audio/ogg`, 32,125 bytes), actual paint photo HTTP 200, owner login HTTP 302, direct owner API without a JWT HTTP 403, and public simulator HTTP 404. Public checks used a browser User-Agent because the existing Cloudflare edge rejects Python urllib's default signature; no access-policy change was made.

## Wording review and WhatsApp test

All fixed Tamil strings are collected in [TAMIL-ALL-DETERMINISTIC-COPY.md](TAMIL-ALL-DETERMINISTIC-COPY.md), with stable IDs, source locations and blank replacement fields. The page contains 420 fixed replies/labels/templates, plus separate input-alias and model-instruction sections: 562 entries in total. Preserve placeholders when supplying replacements. [TAMIL-COPY-SOURCE.json](TAMIL-COPY-SOURCE.json) is the machine-readable source inventory.

To resume the existing WhatsApp list, send **சரி பேக் பண்ணுங்க**, check the offered paint photo/pack, and follow the bill and send-to-shop buttons. At the QR choose **கடைல பணம் தர்றேன்** for the demo. Then open [owner Requests](https://shopbot-preview.sagoautomation.tech/owner?view=requests) to check and prepare that order. Do not claim a payment unless an actual receipt exists. Existing WhatsApp test-recipient and service-window restrictions remain in effect.

## Backup and recovery

The fresh consistent database backup is `/var/backups/shopbot-migration/checkout-20261016T115855Z/database.dump` (65,015,208 bytes). `pg_restore --list` passed before activation. This private directory also preserves the original environment, service unit, prior release pointer and verification evidence. The service remained running while the backup was made.

The previous working audio release `preview-5e57206b0419` remains available for a reviewed code rollback, alongside earlier backups. Restore the saved environment and atomically switch the release symlink before restarting the service. Keep the additive database in place; do not restore an old database over subsequent customer orders or payments. Review any new demo-state orders before using older application code.
