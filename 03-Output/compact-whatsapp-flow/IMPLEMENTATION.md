# Compact WhatsApp flow

Tracking: https://github.com/sagomedia/agent-native-whatsapp-bot/issues/10
Parent implementation: PR #9. This follow-up retains the current inventory, quote, payment and fulfillment rules.

## Returning customer

A greeting with a submitted order offers New list / Add to this order. A new single-item or multi-item text/voice request offers the same explicit choice before any order mutation. The original parsed request stays in persisted conversation memory, even when catalog prices change. New list applies it once using the current catalog; Add to this order creates the existing amendment review and waits for consent. An owner-closed order cannot be amended. Choosing the existing order before sending items remembers that target for the next request. Fresh list-choice versions reject stale buttons. No order is assumed collected merely because time has passed.

## Product review

Ask only the missing pipe type or count. Do not prepend an echo of every requested product. The first carousel card explains the swipe; each actual product retains its identity, pack, count and price/check facts. Unlisted items have explicit shop-check cards. The last image group owns the bill action; every group must be delivered before approval. No separate full-text cart summary is sent. Up to nine products plus one guide use one API payload rather than the previous carousel plus cart-text payload. Larger lists remain complete and paginate at ten cards per group. An unchanged edit uses a short count/subtotal and offers Photo show.

## Invoice

Keep eight actual rows per image, reduce vertical padding and remove a repeated pack label only when its normalized text already appears in the product name. Money/quantity columns stay separate. Single-page invoices omit 1/1. Native text contains the known subtotal and price-pending count; the image and accessible text retain every row. Sending the order and requesting a change remain explicit buttons. The existing ₹10 QR and approved demo pay-at-shop flow remain authoritative.

## Validation

- Text and voice after submission; one saved request, explicit target and no repeated inference.
- Existing-order amendment consent; owner closure between question and tap; stale choice rejection; duplicate callback handling.
- One/five/eight/nine/ten/eighteen/twenty/fifty-product photo groups, every stable line ID retained, final-group approval only, delivery receipts still required.
- Three-language native payloads, pending-price accessibility, eight-row invoice image review and production build/full regression.

Release and validation checkpoints are recorded on issue #10 and PR #11, including the exact deployed source and artifact hash. This design file alone does not assert deployment.
