# Conversation refinement — 2 October 2026

Implemented friendly greetings, bounded recent context, structured conversational intent, fact-based natural replies, clarification-first product choices, conservative typo suggestions, and packaging/size confirmation. Added a distinct 30-product image demo to new local native conversations. Original mock demo and customer test rows retained.

Native UI now previews a WhatsApp chat: customer/shop bubbles, composer, inline photo cards, bound choice/review buttons, no catalog/draft dashboard in the customer conversation. Test settings, quota and hypothetical messaging costs sit in a separate details panel. At most ten cards and one durable outbound envelope per turn; no automatic image blasts. Common greetings and numeric choices avoid inference, and quantity questions after selection avoid resending the same image.

Official Meta carousel/pricing documentation was read through the browser. See WHATSAPP-EXPERIENCE.md for URLs, exact template/card and cost requirements. Owner 50-paise planning estimate is configurable and distinct from real Meta charges. A tested pure delivery planner refuses unapproved/wrong-card-count/over-budget carousel paths and prefers cheaper service/catalog options. No live sender is enabled.

Build/typecheck and all 28 integration tests pass. Live request: hello -> warm greeting (zero AI calls); screw boxes plus some paint -> both lines retained, screw-box size choice and real demo photo; choose screw -> ask boxes; reply 2 -> move on to paint clarification. One generation: 1882 input + 51 output = 1933 tokens. No assumed quantity/paint substitution/confirmation/payment. Product-carousel rendering checked separately with category browsing, requiring no model call.

The image demo is not production catalog verification: flags on brands, stock units, tax and technical claims remain. Broader multilingual/long-conversation/typo evaluation, merchant verification, production identity/handoff and WhatsApp delivery remain pending.

Final browser verification after rebuilding: greeting, Fittings browse (10 real photos in one envelope, draft unchanged), and Ball Valve selection -> quantity question. Three reply envelopes, zero Gemini calls in this fresh conversation; selecting a product did not repeat its photo. Final preview saved as 007-conversation-preview.png.
