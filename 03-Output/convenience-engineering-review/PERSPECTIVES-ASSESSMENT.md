# Five perspectives: fit, factual checks and decision scores

16 October 2026. Review of the five supplied passages, two proposed mockups, the previously reviewed three recordings and local source commit `2c90ece1e036fdcd390827587fa592c342c4a660`.

**Status: recommendations for the owner's decision. Nothing in the attached instructions has been adopted or implemented. No application, inventory, payment policy or VPS changes were made.**

Scores below express my recommendation strength for this project, out of 100. They are subjective judgments about requirement fit, evidence, likely usefulness and disruption. They are **not** measured conversion improvements, probabilities of success, or percentages of a document to implement. Repeated advice from five reviews of the same recordings is not five independent validations.

## Requirements that decide whether an idea fits

- A customer can describe several products naturally by Tamil/Tanglish voice, text or photo. Familiar English mixed into Tamil is intentional.
- Product photos and relevant carousels help identify the right item; the bot maintains a structured cart.
- An unresolved product stays in the list, with no invented price. The estimate includes known-price lines and clearly identifies excluded prices.
- The customer can send that request to the shop. Submission, shop acceptance, preparation, pickup and payment remain distinguishable.
- The approved advance is ₹10. Pay fully at shop is an approved **demo exception**, not the intended production default.
- Estimate/bill images are explicitly wanted. The owner still needs to inspect, quote, accept and prepare real orders.
- Prefer narrow changes that reuse the existing runtime, cart, quote/amendment flow, invoice renderer and outbox.

## Verdict on each perspective

| Perspective | Usefulness as input | What to keep | Where it overreaches |
| --- | --- | --- | --- |
| **P1 — “What you are feeling…”** | **60/100** | Duplicate wording, oversized text banners, hard-to-find checkout action, repeated cart galleries, QR caption cleanup. | Invents confidence about spoken sentences; guesses that batch mutation is missing; defaults unspecified quantities; prescribes CSS for an SVG renderer. Its example UPI account also differs from the configured account. |
| **P2 — “The friction you are feeling…”** | **65/100** | Compact summaries, focused missing questions, changed-item replies, measurement per completed task. | Assumes button routing/search/templates need rebuilding despite existing implementations; claims 60–70% savings; misreads failed-call count; proposes skipping quote approval based only on whether the total increased. |
| **P3 — WhatsApp Retail Bot Implementation Brief + the accompanying passage** | **85/100** | Best evidence discipline: acknowledges no audio/no source access, separates units and financial states, preserves multi-item input and transactional guards, recommends incremental work. | The example state sequence, price-request-first submission rule and payment timing must be adapted. They must not prevent the intended unresolved request from reaching the owner or make production pay-at-shop the default. |
| **P4 — “Watching your three screencasts…”** | **55/100** | Formatting cleanup, focused questions, final shop quote as a proper invoice, concise edit acknowledgements. | Unmeasured 80% claim; quantity/availability assumptions; final-only invoice and later-payment changes conflict with the current brief. “Carousel only once after variants resolve” would also remove a useful way of choosing variants. |
| **P5 — ShopBot UX improvement plan + two mockups** | **50/100** | Strong visual simplification, prominent owner action, inline unresolved pricing, review gallery before release. | English-only-for-brands contradicts the requested spoken Tamil; hiding unknown products changes the service; three backend states lose necessary distinctions; universal Add buttons confuse browsing with cart review. |

These are useful design critiques, not ready-to-run coding instructions. None should be pasted into an implementation agent unchanged.

## Changes I recommend carrying forward

“Small” means wording/rendering within the current flow. “Medium” affects interaction or validation across existing modules. “Major” affects inventory accounting, commercial policy or the domain model.

| ID | Proposal and origin | Score | Scope | Safe interpretation for ShopBot |
| --- | --- | --- | --- | --- |
| **A1** | Replace redundant text-only status images with native text; P1–P5 | **95** | Small | Welcome, saved-list and simple status messages can be short native replies. Keep product photos, estimate/final invoice images and QR. Preserve accessible invoice text. |
| **A2** | Deduplicate and shorten card/QR wording; P1, P2, P4, P5 | **95** | Small | Say the order was sent once. Show a recipient identifier once when name and VPA are identical. Remove repeated quantity prompts. Improve the tone without hiding a real problem. |
| **A3** | Ask only the next missing detail; P1–P4 | **95** | Medium | Ask “M-Seal 90g — எத்தனை pack வேணும்?” with relevant choices. Preserve all other lines. Still accept a single reply that clearly supplies several named quantities. |
| **A4** | Concise cart/edit summaries instead of repeated full galleries; P1–P5 | **90** | Medium | Make routine edits acknowledge only what changed and show a compact summary. Keep product photos available for comparison, changed identity and customer-requested review. Do not ban cart photos universally. |
| **A5** | Put the next action outside the final carousel card; P1–P4 | **90** | Medium | Use a clearly visible summary/action message. Preserve current review IDs, versions and ordered delivery. Sending its button immediately after HTTP acceptance must not recreate the earlier invoice-before-confirmation race. An additional standalone message may increase delivery count; replace redundant output rather than simply appending more messages. |
| **A6** | Use the compact invoice for the shop's final quote too; P2–P4 | **95** | Medium | Reuse the renderer with explicit Estimate versus Final quote labels. Retain the exact quote approval and advance/balance facts. Keep the requested estimate image. |
| **A7** | Explain incomplete subtotals and quote changes; P1–P5 | **95** | Small–Medium | “Known subtotal ₹1,210; three items not yet priced.” Explain the actual ₹360 difference when the full quote arrives. Do not copy the example paint price until its selling basis is confirmed. |
| **A8** | Verify pack, selling unit and price basis consistently; especially P3 | **95** | Medium | Confirm 1 sealed 10L can versus 1 litre sold loose. Reuse the existing pack-content policy. Apply the same checks to catalog publication, quotes, invoices and stock. Never infer a conversion from the title alone. |
| **A9** | Show simple truthful availability by default; P1–P5 | **85** | Small | Usually hide raw shelf counts. Preserve “availability needs checking” when unknown; never turn it into In stock. Show verified remaining counts when relevant to a bulk request or shortage. |
| **A10** | One prominent owner next action with a visible blocker; P3, P5 | **90** | Medium | Distinguish Needs quote, Waiting for customer, Accept & prepare, Packing and Ready. Inline only the unresolved prices/units. Keep cancellation, refund and amendment controls accessible. |
| **A11** | More useful verification with fewer repeated checks; P3, P5 | **85** | Medium | Reconfirm changed facts, not all five facts after every ordinary edit. Keep merchant confirmation for uncertain photo/identity/unit/price/stock. A preview supplements validation; it does not replace it. |
| **A12** | Message/state gallery for Tamil review; P5 | **95** | Small–Medium | Render the real templates and components with fixture data: unknown price, missing count, changed quote, demo/production payment, ready, cancelled and failed media. Compare phone screenshots before deployment. Use the existing Tamil inventory as the starting point. |
| **A13** | Validate price-only enquiries; P3 | **95** | Small validation task | Already supported as a read-only intent. Add representative Tamil/Tanglish regression cases if gaps appear; do not build a second price-enquiry system. |
| **A14** | Reliable multi-item corrections; P1, P2, P3 | **90** | Medium, if a gap is reproduced | The operation-array tool already exists. Reproduce the actual failing utterance first. Resolve visible numbers to stable line IDs from the correct snapshot; never blindly mutate today's item 3 using an old list index. |
| **A15** | Remove demo naming from customer production data; P4, P5 | **85** | Small–Medium | Review visibility and product display names explicitly. Do not merely strip `TEST -` and make an unverified test record look like verified merchandise. Preserve its internal identity and provenance. |
| **A16** | Measure usability and cost before promising savings; P3, P5 | **90** | Small–Medium | Establish comparable tasks and record completion, wrong taps, rescues, delivered messages and model calls. A few customer trials find issues; they do not prove a percentage conversion gain. |

### Stock work remains important, with a larger scope

**90/100 recommendation; Major scope.** The source checks recorded stock during submission but does not reserve or deduct it during acceptance/collection. This is from our source review, not something the external mockups solve.

Implement units first, then reserve on owner acceptance, retain during packing, deduct physical stock once on collection, and release on pre-collection cancellation. Include amendments, restocking, walk-in sales, concurrent buyers and idempotency. Do not retroactively deduct historical orders. The [earlier implementation plan](IMPLEMENTATION-PLAN.md) details this work.

## Ideas to adapt, prototype or decline

| ID | Proposal | Score as written | Scope / concern | My recommendation |
| --- | --- | --- | --- | --- |
| **B1** | Unspecified quantity always becomes 1; P1, P4 | **15** | Changes purchase facts | Do not adopt silently. A **65/100 experiment** could visibly suggest one merchant-defined sealed pack, then require confirmation. Loose length/weight/volume, unclear packs and price enquiries still need their proper handling. An explicitly spoken “one” should of course be retained. |
| **B2** | Collapse all checkout confirmations; P1, P2 | **30** | Commercial consent | Remove a redundant “show bill” round trip when a current bill can be shown automatically. Keep consent to send the request and consent to material revised facts. A payment choice serves a different purpose. Same-total product/unit changes can still need approval. |
| **B3** | Hide every product with an unknown price/stock; P5 | **5** | **Major product-direction change** | Decline. The user explicitly wants these products retained for the shop to identify and quote. Translate uncertainty into one clear sentence and exclude unknown amounts from totals. |
| **B4** | Never expose any unknown/verification status; P1, P5 | **10** | Truthfulness | Hide internal jargon, not material uncertainty. “Price still needed for these two items” is useful customer information. |
| **B5** | Use only Tamil except brand names/units; P5 | **5** | **Audience/tone requirement change** | Decline. Familiar English in everyday Tamil is explicitly requested. Review unnatural words individually; do not remove Bill, order, pack, ready or voice simply because they are English. |
| **B6** | Reduce backend orders to Received / Packing / Ready; P5 | **10** | **Major domain change** | Decline as a state-model rewrite. A simplified visual grouping is **70/100** if quote approval, shop acceptance, pickup, cancelled/rejected and payment facts remain visible and correctly enforced underneath. |
| **B7** | Move the ₹10 advance after shop final quotation; P3, P4 | **25** | **Major business-policy change** | Potentially reasonable for another policy, but not an incidental rendering fix. It changes when the request proceeds and the owner acceptance gate. Keep the current policy until the owner chooses otherwise. |
| **B8** | Make pay-at-shop the general default or remove the advance option; P3, P5 | **10** | **Production policy change** | Decline for the current brief. Preserve the approved demo bypass and the production ₹10 requirement. Show wording appropriate to the actual selected state. |
| **B9** | Replace every Change button with Add; P5 | **20** | Can duplicate cart items | Add/Choose belongs to browsing; Change belongs to an item already in the cart. Use labels according to state, not one global button rule. |
| **B10** | Use an In stock badge for all cleaner mockup cards; P2, P4, P5 | **0** | Invents availability | Use it only from sufficiently current merchant inventory facts. Unknown M-Seal stock cannot become confirmed merely because the mockup uses green. |
| **B11** | All information must fit exactly three rendered card lines; P1, P4 | **50** | Can hide compatibility facts | Use three concise information groups as an editorial goal. Real phones wrap differently; preserve diameter, pack, material or other distinguishing specifications that affect the choice. |
| **B12** | Only one carousel, after variants are resolved; P4 | **25** | Removes useful discovery | Decline that blanket rule. Variant comparison often needs photos *before* resolution. Eliminate redundant repeats; keep relevant comparison and requested review. |
| **B13** | One physical template file; no flexible AI question ever; P5 | **35** | Unnecessary rewrite / less useful conversation | Prefer a shared copy registry and the existing Tamil export. Prices/statuses remain deterministic. Sanitized, relevant AI clarification can remain useful for an unclear hardware job. Structured interpretation needs more than SKU, count and a self-rated confidence score. |
| **B14** | One model call for every whole journey; rebuild matching; P2, P4 | **35** | Accuracy risk; existing search ignored | Reuse existing deterministic search, aliases and fuzzy retrieval. Measure unnecessary calls. Do not forbid a useful clarification or repair merely to hit a universal one-call target. |
| **B15** | Missing prices must be database null, never zero; P3 | **25** as a storage rewrite | Example representation differs from existing code | P3 explicitly presents an adaptable example, not a diagnosed storage bug. Its semantic rule is **95/100**: unknown never means free or enters the total as zero. Current code already pairs a zero placeholder with `priceStatus='confirm'` and excludes it. No standalone migration is justified by this passage. |
| **B16** | Three to five products, Show more, reorder from history; P3, P5 | **75 / 60** | Optional interaction work | A relevant small first page is worth testing, not a universal optimum. Reorder is useful later but must recheck current prices, availability, pack and quantity; it is not required to fix the current journey. |

## Factual corrections and unsupported claims

1. **Exact voice transcripts are unsupported.** P1/P2/P4 describe particular removals or “make everything one” as if the recording proved the spoken words. The supplied videos have no audio stream. Visible voice bubbles and repeated galleries are evidence; exact speech, recognition failure and response latency require the actual message/transcript or a controlled replay.
2. **“The schema only updates one item” is false for this source.** `apply_draft_changes` accepts an operations array. Its extraction or scope handling might still have a bug; the schema guess does not establish the cause. Do not add a parallel reducer based on that guess.
3. **“Buttons currently go through AI” is contradicted by the runtime.** `knownAction` runs before inference. Recognized transactional controls already use deterministic routes; relevant integration tests assert no provider calls. A new static-ID router must not replace the existing opaque, version/context-bound actions.
4. **Fuzzy search and fixed formatting already exist.** The catalog uses real aliases, token/full-text matching and trigram-style word similarity. Customer copy, money and invoice layout are already code-managed. Improvements belong in those modules; an entire new architecture is unnecessary.
5. **The call-count claim is misread.** The recording's Connections frame shows Calls / failed / unknown = **127 / 10 / 0**, not 13 failures. It is labeled all recorded usage, not the cost of one order. It cannot prove a 60–70% saving. P4's 80% clutter/cost claim is also unmeasured, and P1's “half the taps” is a hypothesis.
6. **The CSS prescription does not match the implementation.** The invoice uses font shaping and SVG rendered through Resvg. Narrow quantity text can wrap poorly and deserves a layout check. `white-space: nowrap`, CSS line-height or flexbox on an imagined HTML table will not fix this renderer. Never fill in a guessed number just to make a column look tidy.
7. **A correct zero advance is not a contradictory payment record.** After demo pay-at-shop, ₹0 verified advance is truthful. The messages can be shorter and clearer, but recording ₹10 received would be a false fix. Submission also does not mean the shop accepted or the order is ready.
8. **Some QR observations are real, but examples are not configuration.** The duplicated sent-to-shop sentence and duplicate name/VPA can be cleaned up. P1's quoted payee identifier differs from the approved account; it must never be copied into code. Preserve the actual configured VPA and ₹10 amount. A QR/payment link must also remain usable on the same phone, not only through a second device scanning it.
9. **The 1,000-message pricing statement is supported, not a hallucination.** I checked the current official [WhatsApp FAQ pricing section](https://whatsappbusiness.com/resources/faq/). It states that service delivery becomes charged beyond the monthly 1,000-message allowance per business phone number from 1 October 2026. Actual account/carousel billing still needs applicable rates and receipts. This does not establish the savings claimed in the other passages.
10. **Mockups do not establish API support.** The current working carousel and its payload validator remain the implementation reference. A same-screen button arrangement, a native UPI button or fixed text line count in a drawing is not evidence that the account/API supports it. Meta's carousel developer page was inaccessible during this check; I am not asserting new payload limits from these drawings.
11. **A generated PNG is not necessarily a paid image-model call.** These banners and invoices are rendered locally through SVG/Resvg and cached. Native text may improve readability, loading and rendering work, but removing a banner does not automatically remove a Gemini call or halve its token bill.
12. **Card count is not delivery count.** The existing renderer places several cards inside one carousel message. A carousel with six cards is not automatically six billable deliveries. Repeated whole carousel sends still add deliveries; appending a separate CTA can add another one. Measure actual outbox/provider deliveries before calling a redesign cheaper.

## What to take from the two images

**Customer mockup:** adopt the clearer hierarchy and visible cart action. Keep the original idea of photos for product choice. Do not adopt its paint `10L × 1 = ₹250` as verified, invent availability for unknown stock, or turn the demo's pay-at-shop sentence into production policy. A compact text cart can supplement the invoice image the owner requested.

**Owner mockup:** adopt the prominent task, compact line items and inline unresolved price. The large Ready button must stay disabled or be replaced by Resolve quote when a price/unit is unresolved. Its invented customer name is fixture content, not known identity. Three tabs may group work visually; they must not erase Checkout, customer approval, payment or cancellation information.

Moving technical settings away from daily work is sensible but partly already done: costs and pricing are in Connections & usage, and interpretation evidence is behind a control. The remaining opportunity is task focus and less intrusive history, not building a second settings screen or deleting diagnostics.

## My proposed selection for your decision

**First, low-disruption improvements:** A1–A3, A6–A9 and A12. Clean up banners/duplicate copy, ask focused quantities, improve the final invoice, explain money changes and validate pack/price basis. Prototype A4/A5 with the real renderer and delivery guards before changing the full checkout presentation.

**Next, operational work:** A10/A11 plus the separately scoped stock ledger from the earlier plan. Keep A13/A14 as targeted validation/fixes of existing capabilities; do not budget them as wholly new systems. A15/A16 support a cleaner production catalog and measurable trials.

**Leave policy/domain decisions separate:** B1/B2 and B3–B8 require explicit product decisions where indicated. My recommendation is to preserve unknown-item requests, Tamil mixed with familiar English, the requested estimate image, existing consent/state distinctions and the approved ₹10/demo policy.

This is a candidate list, not authorization to implement it. The owner can select IDs and revise the Tamil wording before the implementation scope is finalized.

## Source and evidence anchors

- [Original implementation plan](IMPLEMENTATION-PLAN.md) — detailed stock/unit/fulfillment scope.
- [Structured operations and read-only price contract](/home/gk-pc/whatsapp-bot-finish/02-Build/shopbot-ai/packages/contracts/index.ts:31), with the batch tool at line 41.
- [Deterministic routing before inference](/home/gk-pc/whatsapp-bot-finish/02-Build/shopbot-ai/apps/server/src/runtime/conversation.ts:133).
- [Existing catalog retrieval](/home/gk-pc/whatsapp-bot-finish/02-Build/shopbot-ai/apps/server/src/services/catalog.ts:29).
- [Current product review and carousel action](/home/gk-pc/whatsapp-bot-finish/02-Build/shopbot-ai/apps/server/src/services/visual-ordering.ts:74).
- [Current quote presentation](/home/gk-pc/whatsapp-bot-finish/02-Build/shopbot-ai/apps/server/src/services/order-quotes.ts:38).
- [Actual SVG invoice renderer](/home/gk-pc/whatsapp-bot-finish/02-Build/shopbot-ai/apps/server/src/services/visual-images.ts:37).
- [Separate demo and production advance copy](/home/gk-pc/whatsapp-bot-finish/02-Build/shopbot-ai/packages/contracts/customer-copy.ts:18).
- [Current owner actions and existing settings page](/home/gk-pc/whatsapp-bot-finish/02-Build/shopbot-ai/apps/dashboard/src/OwnerDashboard.tsx:55).
- [Existing per-fact verification reset](/home/gk-pc/whatsapp-bot-finish/02-Build/shopbot-ai/apps/dashboard/src/OwnerCatalog.tsx:44).
- [Call-count screenshot from the supplied recording](/home/gk-pc/shopbot-convenience-review/frames/03-40.png).

## Supplied passages reviewed

- P1: [What you are feeling…](</home/gk-pc/.codex/attachments/f329ac9b-21c1-4b49-a78a-b830d8ea7752/Pasted text.txt>)
- P2: [The friction you are feeling…](</home/gk-pc/.codex/attachments/2c7a5792-b39d-4021-b206-f83109c21fdf/Pasted text.txt>)
- P3: [WhatsApp Retail Bot Implementation Brief](</home/gk-pc/Downloads/temp_files/WhatsApp_Retail_Bot_Implementation_Brief.md>), plus the accompanying passage in the user message.
- P4: [Watching your three screencasts…](</home/gk-pc/.codex/attachments/d394da8a-ace3-432e-9750-6d8329358cea/Pasted text.txt>)
- P5: [ShopBot UX improvement plan](</home/gk-pc/Downloads/temp_files/ShopBot UX improvement plan.md>), plus the two attached proposed-screen images.
