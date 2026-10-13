# Clear, visual WhatsApp ordering

The visual feature uses the existing text, speech recognition, photo recognition, catalog, pickup and staff workflow. Backend services control product identity, selling-unit counts, estimates and both approvals. The AI proposes language/intent and validated operations; it cannot submit orders.

## Enablement

Add `WHATSAPP_VISUAL_ORDERING_ENABLED=true` to the private channel environment and restart. It defaults off. `WHATSAPP_MAX_DRAFT_LINES` defaults to 50 and accepts 1–50. `VISUAL_MEDIA_DIR` must name a persistent writable directory (on the VPS, `/var/lib/shopbot-vps/visual-images`). Existing drafts and messages are preserved. Ambiguous legacy measurement quantities require a fresh count. Existing submitted requests remain immutable.

The local AI simulator can opt in with `LOCAL_VISUAL_ORDERING_ENABLED=true`. Integration tests use independent temporary PostgreSQL schemas and a fully offline interpreter/transport, with no customer delivery or paid AI calls.

## Progression and approvals

A current full product snapshot covers all line IDs and verified catalog identities. Product approval advances to missing count questions, then a separate estimated-bill review. A count answer to the current missing-count question retains product identity approval; subsequent corrections invalidate it. Edits preserve unaffected lines, refresh the entire proposed list and require fresh approvals. Product facts and prices are rechecked before submission. Final consent is a current button or whole-message text; speech can request/correct, but cannot submit. A review expires after 15 minutes. Submission remains exactly once through the unique review ID and tool receipts.

`quantity` is the amount in the catalog selling unit. `packSize`, `requestedAmount` and `supportingPhrase` hold independent evidence. Explicit size/count confusion is guarded before applying writes. Conversion requires verified catalog pack information and valid selling-unit increments. A dimension alone never becomes a can count.

## Images and delivery

`VisualCard` separates real catalog products from instruction, bill and status images. Product reviews hold up to nine products plus one instruction per message. The last instruction holds global approval. Bills hold at most five item rows per image and up to ten images per carousel. The final bill image holds submission; previous cards offer corrections/help. There is no two-carousel limit. Missing items stay on the draft with shop-check images and cannot pass ordinary global approval.

Tamil/Latin text is shaped with bundled Noto fonts using fontkit into SVG paths, then rendered by resvg-js. This avoids the mixed-script shaping failures observed in the initial renderer preview. The PNG filename is the hash of the complete rendered SVG; static cards and unchanged bills reuse cached files. Public media paths contain only hashes and no customer identifiers. Never put phone numbers or addresses in these cards. Catalog photos retain their existing media paths.

Migration 23 adds per-message group ID/index/count, stage and clarification reason, plus the product-review proof. Replies remain one tracked outbox row per actual WhatsApp message. Earlier parts must be accepted before later parts can send. Approval checks every part in the current group. Failed/unknown sends retain their existing handling; old queued reviews are cancelled after edits. Delivery tracking, provider callback IDs and deduplication remain per message. The dashboard shows the same groups, captions and native action labels.

Every status notification includes the short order reference. Status notifications retain the existing per-order/per-state deduplication and distinguish acceptance, preparation, pickup and payment.

## Pricing and operations

`WHATSAPP_SERVICE_RATE_PAISE` is the configured combined provider/channel service-reply charge. It defaults to zero for the Meta service-message component within the customer's 24-hour window. Additional provider fees must be configured; the planner uses actual ordered message counts. It does not send outside the service window or automatically use marketing templates. Source: https://whatsappbusiness.com/products/platform-pricing/

The VPS public ingress must route both `/catalog-images/custom/<uuid>.jpg` and `/catalog-images/messages/<hash>.png` to the existing app, alongside its existing webhook/privacy/catalog routes. Owner authentication remains on the separate dashboard hostname.

The release packager can bundle strictly additive dependencies while hard-linking unchanged dependencies and the immutable installed Node runtime. Both packaging and staging verify every existing lock entry is unchanged and the exact base-lock hash matches. The previous release is retained; staging refuses to consume the last 1 GiB. Changed existing dependency versions require a complete bundle.

## Preview and verification

Run `node --import tsx scripts/visual-preview.ts` to generate `preview/visual-ordering/index.html`, actual PNGs and the full gallery data. Run `npm run build` and the integration suite with a disposable database. See `tests/visual-ordering.test.ts` for grouped coverage, text/voice dimensions, targeted corrections, missing items, returning drafts, truncation, stale/expired consent, changed prices, legacy ambiguity, 50-item editing and partial delivery failures.
