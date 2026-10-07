# Visual WhatsApp ordering

Implemented on the deployed-source baseline `d9cf10e`. Live rollout on 5 October replaced the old text adapter, applied migration 17 and added the exact catalog-photo tunnel route. WhatsApp delivery callbacks confirmed a four-product cutter carousel at 09:03 UTC. The live tap then exposed Meta's separate carousel quick-reply callback shape; the adapter now accepts it alongside ordinary interactive replies.

Product discovery and selection use one service message with 2–10 photo cards and product-specific quick replies. One product uses an image header with reply buttons. Missing/unusable photos use one native list; they do not become ten separate images. Discovery can return ten relevant results; no unrelated filler is added. Existing retrieval hard constraints and store isolation remain authoritative.

Categories use native lists or buttons. A selected product with no quantity offers valid quantities 1, 2 and 5, with free text for other amounts. Known quantities survive product selection. Multi-item checks offer **Add these items** alongside per-product choices when each line has an identified suggestion. Accepting product photos prepares the order review; it never submits the order. Review offers **Confirm request** and **Edit list**. Confirmation records an order request awaiting the shop’s approval; it does not claim stock, readiness or payment.

## Delivery and tap handling

`whatsapp-reply.ts` renders the actual Cloud API payload. `whatsapp-channel.ts` persists it in the existing outbox with opaque action IDs and validated backend events. IDs map to the sender store, customer conversation, operator revision, draft version, current question/search binding, originating message and expiry. Customer button titles are display data, never commands. Text product-code choices remain available.

Carousel `type: button` callbacks resolve the opaque ID from `button.payload`. Ordinary `interactive.button_reply` and `interactive.list_reply` callbacks resolve their IDs through the same validated action mapping. Button text and titles never select an event. Buttons do not consume a Gemini call. Duplicate provider messages are deduplicated; stale, expired, unsent and cross-customer actions leave the draft unchanged. Delivery keeps the existing 24-hour window, owner pause, callback reconciliation, bounded 429 retry and unknown-outcome protection. No marketing template is sent automatically. If Meta rejects an interactive format, delivery records the failure; the adapter does not fan out images or blindly resend an uncertain message.

Migration 17 adds immutable outbox payloads and durable action mappings. Existing text-only queued messages remain sendable. Catalog photos under `/catalog-images/Hxx.jpg` are read from the preserved public demo images only if the image belongs to an active product in the configured sender store. Customer media and private application routes are excluded. The public API hostname must route this exact image path through the existing tunnel when deploying; verify the resulting URLs before enabling delivery.

## Verified API contract

Session media carousels contain 2–10 cards, a required body up to 1024 characters, and identical button counts/types across cards. Card bodies fit 160 code points and two line breaks. The card discriminator is `cta_url` even for `action.buttons` containing `quick_reply` objects. Standalone reply buttons instead use `type: reply`, with at most three. Lists contain at most ten rows total. Labels are shortened at Unicode grapheme boundaries, preserving Tamil clusters. Full order review text must fit before confirmation; it is never silently clipped.

Primary provider references checked 5 October 2026:

- [Vonage: native carousel and exact quick-reply payload](https://developer.vonage.com/en/messages/guides/whatsapp-carousel-interactive-messages)
- [360dialog: session media carousel constraints](https://docs.360dialog.com/docs/messaging/message-types/interactive/media-carousel)
- [Meta official Postman collection: reply buttons](https://www.postman.com/meta/whatsapp-business-platform/request/ne00kt6/send-reply-button)
- [Meta archived SDK: interactive messages](https://whatsapp.github.io/WhatsApp-Nodejs-SDK/api-reference/messages/interactive/)

Meta’s current developer pages returned HTTP 429 during this review. Payloads were cross-checked against current primary provider documentation and SDK source. The live account accepted and delivered the four-card carousel; local channel tests additionally exercise Meta's carousel callback format through final confirmation. Actual Tamil glyphs and photo crops still require device inspection.

## Other WhatsApp features

WhatsApp Flows can collect several checkout fields in one native form. This application currently supports pickup orders and does not have a published Flow ID or verified delivery policy. A published Flow, its completion webhook and any additional fulfillment rules must be integrated before claiming a form checkout. Location/address requests, catalog cart/order webhooks, payment actions and proactive template sends also require corresponding verified store policy/configuration. They are not silently inferred from a product selection.

## Screenshot audit

The supplied reply showed pipes alongside cakes, broken Tamil glyphs, long clipped names and repeated stock caveats. The renderer sends native UTF-8 text with compact photo/name/price/unit cards; it does not rasterize labels or fabricate MRP. Store-scoped, relevant discovery is still required before rendering; a carousel cannot repair incorrect retrieval. The exact cause of the screenshot’s missing glyphs cannot be established from a screenshot alone. Live device rendering must verify Tamil fonts and product image crops.
# Tamil Multimodal Customer Update - 6 October 2026

Sequential update `preview-d385c6bec164`: the live channel enables `WHATSAPP_SEQUENTIAL_ITEMS_ENABLED=true`. A multi-item request is retained in full, but ambiguous/missing-detail requests show one category at a time. Confirming that product finishes its missing quantity/unit before moving to the next item; exact, complete initial lists can use grouped confirmation. Localized item progress is included, and final review shows quantity times catalog unit price and line totals in structured message text. Submitted-order proposals preview only the first category, with all later items retained. This workflow adds no AI calls to button/quantity progression and keeps separate final request consent. Full native channel progression is verified in regressions; a fresh exact-version customer phone test is outstanding.

Latest release `preview-19d8309a4205`: WhatsApp voice/photo recognition can run one additional read-only question/recommendation step over fresh matching catalog facts. The question is above the native product carousel. Text recommendation staging stays off in the live test configuration. New submitted-order follow-ups show up to four product previews before cart changes; each card can select that product or start the full proposed list. A product selection retains every proposed line and amount, confirms only the selected item, and does not submit an order. Start this list takes precedence over More options as the secondary button on these proposal carousels. Ordinary discovery still uses its More options menu. The customer's latest recovered Tamil voice replay was confirmed delivered as a four-card native carousel; full selection progression is verified by channel regressions, not a fabricated live tap.

The following paragraphs describe the preceding release behavior, superseded where noted above.

Current discovery pages show up to four real product photos; multi-item confirmations retain all requested groups. Each native carousel card has two consistent quick replies: choose/all correct and More options. That version-bound menu exposes current catalog filters, targeted list editing, browsing and shop handoff without another AI call. Native list fallback prioritizes product choices within its row limit. Old actions remain invalid after list/version/owner changes.

After a submitted request, a new multi-item voice/text list stays a read-only saved proposal until its bound Start this list button is tapped. All items and separate amounts then enter normal product/quantity checks without repeating the message; final submission still needs separate confirmation. The model never receives the old submitted draft IDs or pending edit context. Photo recognition cannot force a nail into a screw family; actual visible keywords and supported specification fields feed deterministic catalog search.

Tamil is the default, with explicit Tanglish/English preferences. Known language changes, selection, quantity, review, list edits and handoff use deterministic tools. Unknown text, photo and voice requests use one paid multimodal identification call by default, with the second recommendation stage disabled for margin control. Audio goes directly to Gemini after bounded normalization; no local speech model or TTS is used. The dedicated voice contract and strict backend validation require its original-language transcript before any shopping action can validate; generation uses JSON mode after Google's native schema rejection.

Optional Meta read/typing indication is once-only and does not create an outbound message. Attachments remain private, download only from trusted HTTPS hosts, have bounded retry for network/server failures, and stay subject to 2 MB photo and 30-second/1 MB voice limits. The live allowlisted test deployment explicitly enables these controls with durable budgets. See `CUSTOMER-EXPERIENCE.md` and the deployment report for verification and actual phone outcomes. Historical implementation notes follow.
