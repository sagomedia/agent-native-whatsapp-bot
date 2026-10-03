# Shop assistant conversation and WhatsApp delivery design

User direction recorded 2 October 2026: friendly shop assistant, not a pushy salesperson. Treat chat as the primary customer experience. Understand spelling mistakes and context, ask about vague products/sizes/quantities, and confirm actual choices. Keep every requested category; never silently substitute unrelated products. Use product photos selectively, with at most ten cards and one outbound reply per incoming turn. No unsolicited image batches, automatic paging, promotion or popup flow.

## Official documentation checked

Meta media-card carousel templates, updated 24 June 2026, were read in the browser because the web fetch was rate limited: https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/marketing-templates/media-card-carousel-templates/

A media carousel is one approved marketing template with 2–10 cards. Sending requires the same card count as approved; cards share component structure. Cards can have image/video headers and up to two buttons. Quick replies can keep selection in chat; URL buttons leave it. One product is not a carousel. These constraints must be checked by a future sender, not assumed satisfied by a browser preview.

Meta pricing, updated 30 September, effective 1 October 2026: https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing/

Meta bills delivered outbound messages by category and recipient market. Incoming messages are not charged. Each phone number has 1,000 free service messages monthly, then charges apply; free-entry conditions are separate. Non-template replies require the 24-hour service window. Marketing carousels are not automatically service messages. The generic business pricing page still showed older free-service copy, so the dated developer documentation is used here.

Feature overview: https://whatsappbusiness.com/products/business-platform-features/ — media, reply buttons, lists, and catalog single/multi-product messages are supported presentation options.

## Implemented locally

The default mock demo remains separate. New native test conversations use a distinct synthetic KSMC image-demo store with 30 public products and original photos. Source brand, tax, unit and technical review flags are not resolved by loading this fixture. Prices/images are demo references, not verified merchant promises. Paint is absent: the assistant asks about use/type instead of showing solvents or stencils as paint.

Pure greetings/thanks/help avoid model calls and do not mutate the draft. One generation interprets a customer request using the current draft, public catalog and up to eight short recent messages. It can propose a conversational intent and one short clarification question, subject to text constraints. Product facts, totals, selection bindings and confirmation permissions stay owned by deterministic tools. Output wording is composed from validated facts; no second model call is needed to narrate it.

Public category/unit aliases help search. Conservative one-edit word suggestions handle common typos, while numeric sizes remain exact. Fuzzy matches and vague sized screw-box requests require a choice even when one candidate is found. Cards are capped at ten; larger lists ask the user to narrow them down. Product selection never assumes quantity one. Choices and numeric quantity answers use no model call. Photos are not repeated just to ask quantity after a selection.

Each processed inbound event creates one durable outbound rich envelope, with text/cards/buttons together. The UI places cards inside the same chat bubble and disables obsolete choices. This is a local visual/behavioral preview, not an approved WhatsApp template or delivered customer message.

## Cost policy

WHATSAPP_PLANNING_PAISE defaults to the user’s 50-paise assumption and can be changed; it is an owner planning estimate, not a universal Meta rate. The test details show message count and a hypothetical estimate. Actual WhatsApp spend is zero because no sender is connected.

services/whatsapp-plan.ts is a pure future-delivery planner. It prefers an available cheaper service/catalog/list reply, limits the plan to one message, permits a marketing carousel only with an exact approved card count and explicit marketing budget, and blocks when no permitted format is affordable. It never splits a gallery into image messages. Current approved-template/capability metadata, actual category rates, service-window state and delivered-message accounting must be supplied during channel integration. Marketing requires an appropriate opt-in/delivery policy; a preview is not authorization to broadcast.

## Verification and remaining work

Build/typecheck and 28 isolated integration tests passed. One real Gemini request for screw boxes plus paint retained both vague lines and produced the pictured screw choice; greeting, selection and numeric quantity used zero additional calls. Model usage: 1882 prompt + 51 candidate = 1933 tokens. Existing demo/history was retained. No WhatsApp delivery or payment occurred.

Still needed: broader spelling/language/correction evaluation, verified merchant catalog and units, real catalog/template media identifiers, approved carousel variants and delivery-window/rate enforcement. Production identity and human handoff remain separate work. Initial persona is ShopBot’s helpful, concise shop-assistant voice; merchant-specific tone configuration can follow measured conversation tests.

## Ordering edge cases — 2 October 2026

Customer and technician Luna reviews added contextual yes/decline/clear/remove-it, stale-question protection, strict native edit-field translation, explicit catalog-unit clarification, quantity price quotes, and truthful shop-policy questions. Exact SKU lookups now protect item/packaging identity from alias collisions during refresh. The planner additionally requires marketingOptIn=true and chooses the cheapest approved eligible carousel. See ../../03-Output/008-order-edge-cases.md for test transcripts and evidence.

Final edge-case validation: 41 integration tests pass. Explicit price inquiries and variant quote buttons are read-only; Add to my list is a separate explicit action. The generation schema remains the compact canonical contract, with strict response-only compatibility aliases.
