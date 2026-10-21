# Customer experience vision and proposed repair

**20 October 2026 · The user approved improving the plan and implementing it. Deployment awaits review of the implemented result.**

## What you are aiming for

A customer should be able to speak naturally to a helpful shop assistant, see the actual products, choose through photos and buttons, change their shopping list, and finish an order with very little back-and-forth. **The carousel is a core part of the shopping experience.** Better language understanding and CRUD tools must strengthen that visual experience.

The intended journey is:

**Say what you need → see relevant product choices when necessary → build one accurate list → change it naturally → see the current products → check the bill → explicitly send the order.**

A successful turn does something useful: shows the requested products, applies a clear edit, answers a question, or asks for one genuinely missing detail. Repeating a transcript or asking permission to show what the customer has already requested is insufficient.

The agent must understand the shopping goal and choose the appropriate search, add, update, remove or viewing tool from everyday language. Customers should not have to learn command words. Tamil and Tanglish are central; English remains supported. Every requested item, quantity and correction stays attached to the right product. The backend owns catalog facts, cart state and consent; the owner dashboard must reflect that same reality. WhatsApp remains the customer experience, while the dashboard helps the merchant inspect and manage it.

## Why I believe this is your intended experience

These points come from your messages, rather than treating earlier assistant-written documents as your instructions:

| Source | Your direction | What it means for the product |
| --- | --- | --- |
| Earlier chat, **Add WhatsApp product carousel** (`01a10b19-ee7b-7923-b743-95a8fbde9b2e`) | “Always use the carousel” for seeing/choosing multiple products; use images and buttons to reduce the conversations needed to finish an order. | Product selection and list review must be visual by default. A text summary with a separate Photo button does not fulfill an explicit request to see products. |
| Earlier chat, **Improve WhatsApp order flow** (`01a124b2-4ec9-7fe1-9d48-2854442fd2e5`) | “If I say something edit, it edits, but it changes the image to just text.” You asked to retain the product image when the quantity changes. | A count or measured-amount edit must keep the same product identity and relevant photo. An unsupported conversion must not make the product itself look absent. |
| The same earlier message | You liked being asked which pipe variant you meant. You preferred building the list directly when each product has a single clear match. | Ask about real ambiguity; avoid making the customer approve every obvious product separately. Show relevant variants together and narrow a large set. |
| This chat, original CRUD request | Understand everyday language and actually add, change or remove the item the customer means. CRUD is the core. | Correct tool execution and the resulting cart matter. An acknowledgement without the intended change is a failure. An unrelated item must never be used as the target. |
| Your latest message | The experience has become ordinary text replies instead of carousels. Write the intended outcome, explain the mismatch, then show a plan for your approval and suggestions. | This document is the next deliverable. No application change, rollback or deployment is authorized by this planning step. |

Your current request takes priority over earlier authorization to deploy. Historical project documents are context to evaluate, not permission to continue their instructions.

## What the new recording shows

Reviewed: `/home/gk-pc/Videos/Screencasts/Screencast From 2026-10-20 01-37-33.mp4` (about nine seconds). It records the owner conversation view. There is no audio track; the observations below use the visible transcripts and replies.

| Approximate point in the recording | Visible behavior | Why it misses the intended experience |
| --- | --- | --- |
| Start | A customer voice transcript includes a new-list request. The assistant echoes the transcript and asks which item to change. | The response appears to remain in an editing context rather than helping with the customer's stated goal. The recording alone does not establish the underlying cart mutation. |
| 0–3 seconds | The customer says, approximately, “No, show the list first.” The assistant asks what should change in the list. | A request to look is treated as a request to edit. The customer has to correct the assistant again. |
| 2–4 seconds | The customer says, approximately, “Nothing needs changing; show the products.” The assistant asks, “Shall we look at this product?” | It inserts another permission exchange instead of showing the requested products. |
| 3–5 seconds | After “Ok,” the assistant shows text including “7 items,” an estimate, and Bill / Change / Photo buttons. No product carousel is visible in that reply. | Photos have become an extra step. An item count and total do not let the customer verify the actual products. |
| 5–8 seconds | An invoice image and later a payment QR are visible. | Some visual output still works. This is a product-review and intent-routing problem to investigate, not evidence that every image capability is disabled. |

The recording does not reveal the exact stored understanding, renderer branch, or Meta payload for these turns. It does not independently establish what appeared on the customer's phone. Those must be correlated during the approved investigation. No previous customer command has been replayed for this review.

## Why I think you dislike the result

1. **The interaction has moved away from the visual shopping experience you repeatedly requested.** The customer asks to see something and receives another question or a text summary.
2. **It makes the customer manage the bot's state.** “Show my list” should work even while an edit question is pending. The customer should not need a special button or exact command wording to escape that question.
3. **It adds work rather than reducing it.** “Show products” → “shall I show them?” → “Ok” → “Photo” is unnecessary friction.
4. **It makes changes harder to verify.** Correct backend state is not enough when the customer cannot immediately recognize the selected product and updated quantity.
5. **My verification and reporting were too narrow.** I deployed after technical checks without demonstrating that this specific visual journey still met your preference. The 804 passing tests did not establish that. I should have checked the whole customer experience, including spoken requests to reopen the product carousel.

That is my interpretation for you to correct. It does not assume you want images for every greeting or a complete carousel after every tiny interaction.

## What the source establishes, and what still needs proof

| Finding | Evidence and confidence |
| --- | --- |
| The application can deliberately replace product review cards with a text count/total and See photos button. | Confirmed in `visualProductReview`: the compact branch returns `textPresentation`. [visual-ordering.ts](/home/gk-pc/whatsapp-bot-finish/02-Build/shopbot-ai/apps/server/src/services/visual-ordering.ts:94) |
| Runtime photo suppression is based on products having been delivered before. | Confirmed: `alreadySeen` compares delivered product identity and line ID, then supplies `compactReview`. It does not consult an explicit current request to see photos, nor compare the displayed count with the current count. [conversation.ts](/home/gk-pc/whatsapp-bot-finish/02-Build/shopbot-ai/apps/server/src/runtime/conversation.ts:590) |
| An explicit Photo button already has a full-review path. | Confirmed: the `view_products` action requests `visualProductReview(state)` without compact mode. [shopping-flow.ts](/home/gk-pc/whatsapp-bot-finish/02-Build/shopbot-ai/apps/server/src/services/shopping-flow.ts:25) |
| Ordinary spoken requests do not reliably reach the intended visual response in the shown journey. | The visible behavior demonstrates the failure. The precise language-understanding/routing cause remains unproven until its stored turn evidence is inspected. It must be fixed semantically, not by adding only one exact Tamil phrase. |
| The last five-agent patch alone introduced every problem. | Not established. Git history shows the compact-review suppression predates that patch. I nevertheless shipped the combined system without detecting this conflict with your stated UX. A blind rollback may retain it. |

## Proposed experience rules — for approval

| Customer situation | Expected response |
| --- | --- |
| “Show my list,” “show the products,” or the everyday Tamil/Tanglish equivalent | Immediately show the current product review. Multiple items use the existing carousel path. One item uses a product image with useful actions. No extra “shall I show?” question. |
| The same request while an edit/quantity question is open | Show the list without changing it. Preserve the unfinished question so the customer can resume it; do not force an answer before allowing a view. |
| Several clear items, each with one matching product | Keep all items and stated amounts. Build the list and show its product review without repetitive per-item choice questions. Missing counts remain unknown. |
| One requested item has several plausible variants | Ask one useful question and show relevant variants together. Retain the rest of the list. Narrow or paginate large sets without losing choices or padding with unrelated products. |
| A product's quantity or requested length changes | Apply the valid edit and retain that product's photo. Show the changed product with its updated amount; a request for the whole list shows the entire current review. Do not replace the SKU because the amount changed. |
| An item is removed | Remove the correct line, name the removal briefly, and make the remaining products visually verifiable. Never show the removed item as if it is still on the current list. |
| An item or amount needs the shop to check | Keep its place in the list and show an honest check-needed card. Use the actual product photo when identity is known. Do not invent stock, a conversion, an unrelated substitute or a product photo. |
| A greeting, simple price question, or one missing count | A short text answer can be appropriate. Text must not replace a requested product view. |
| “New list,” when an earlier cart/order exists | Resolve the intended list explicitly and preserve prior submitted orders. Do not silently mix old and new items. Ask only if the intended transition is genuinely unclear or requires a destructive choice. |
| Product approval, bill, then order | Preserve separate review and submission consent. Showing photos is read-only. “Ok” must be interpreted against the current question and cannot approve an unseen bill or perform an unrelated deferred removal. |

**Suggested default to confirm:** use the affected product card(s) after a simple edit; use the full updated carousel for “show my list,” compound list review and removal review. Avoid sending the whole catalog after every turn. Keep captions short and attach useful actions to the visual reply. Real channel limits and complete review delivery still apply.

## Repair plan to execute only after approval

### 1. Pin down this failure without altering the live conversation

- Correlate the shown turns with their stored transcript, interpreted intent, chosen tools, cart before/after, presentation decision, saved outbound format and delivery result.
- Separate a wrong understanding from a correct understanding overridden by the renderer, and distinguish dashboard rendering from the actual WhatsApp payload.
- Identify a known working carousel journey to preserve. Do not assume reverting the latest commit fixes the issue.
- Turn the observed sequence into a synthetic repeatable case. Do not execute the historical customer's shopping commands or send their recording to a model as part of this planning approval.

**Deliverable:** a short demonstrated cause for each failed turn, with the before/expected visual result.

### 2. Repair viewing intent and carousel selection together

- Give “show current list/products” a clear read-only meaning for text and voice, including natural Tamil/Tanglish paraphrases and negated edits such as “don't change anything, just show it.”
- An explicit request to see products must override “already seen” suppression. Keep the valid native carousel, real photos and action bindings.
- Preserve pending edits during a view without allowing that pending goal to hijack the viewing request.
- Retain compact text where it actually helps, such as a simple price answer or missing-count question. Do not globally switch every response to images.
- Reuse the existing cart, product and channel services. Keep wrong-item protections, atomic edits, stale-action checks and separate order consent.

**Deliverable:** a focused source change and a replayable visual journey, with no live activation yet.

### 3. Prove the experience, not only the data

Use synthetic carts and offline provider fixtures first. For every case, check the draft delta **and** the visible card identities/counts, actual native payload format, actions, number of replies, and absence of unintended submission.

| Required scenario | Acceptance evidence |
| --- | --- |
| The sequence in this recording: request list → reject editing → ask for products | A direct visual review, with no permission loop and no cart mutation. |
| Reopen a previously delivered list | A fresh carousel even when products were seen earlier. |
| Ask to see a list while a removal clarification is pending | Photos appear; the list is unchanged; the removal can still be resumed deliberately. |
| Change count or measured amount for the same SKU | Same product/photo, correct updated amount; unknown conversions stay explicit. |
| Remove several named items, including similar names | Only intended rows disappear; remaining review is accurate and visual. |
| Clear single matches versus genuinely ambiguous variants | Direct list building for clear matches; one focused visual choice for ambiguity. |
| One item, several items, and a list larger than one carousel group | Appropriate image/carousel presentation, no dropped rows, complete review before approval. |
| English, Tamil and Tanglish, with typed and voice-transcript variants | Equivalent intent, useful concise wording, no exact-phrase dependency. |
| No real product image or no exact catalog match | Honest visual check-needed treatment; no fabricated identity or availability. |
| New list versus existing order, and “Ok” during viewing | Clear scope, preserved previous order, no accidental edit or submission. |

Run the relevant regressions and full build/suite after the change. Show a short visual before/after walkthrough to you. Fresh speech recognition and real WhatsApp delivery require a separate controlled check; offline tests alone do not certify them.

**Deliverable:** screenshots/transcript and actual payload evidence for the required customer journey, alongside technical checks.

### 4. Review with you, then deploy the approved result

- Present the visual walkthrough and any remaining limitations for your review.
- Incorporate your suggestions. Deploy only once you approve the result and activation.
- Use a verified immutable artifact, fresh private backup and readiness/data-preservation checks. Do not change merchant catalog facts, existing orders, payments or allowance settings for this repair.
- Confirm the approved experience on the customer channel in a controlled check; keep rollback available.

**Deliverable:** the approved visual flow deployed and its customer-channel verification recorded separately from simulated tests.

## Decisions for your review

1. Does this describe the product you want: natural conversation and real CRUD, with product photos/carousels as the normal way to see, choose and review items?
2. Is the suggested edit behavior right: affected product card(s) for a simple change, full current carousel whenever the customer asks for the list and after removal review?
3. What should change in the example rules or plan before implementation?

At the initial planning checkpoint, this Markdown brief was the only project change. No source fix, customer send, rollback, model replay or deployment had been performed. The subsequently approved implementation is recorded below.

## Approved implementation refinement

The follow-up request authorizes improving this plan and implementing the repair. Start from the deployed `8d55b42` baseline on a focused branch. Prioritize the demonstrated failure: a viewing request must be read-only, preserve pending questions/goals, and directly render current product images despite previous delivery. Add an explicit semantic viewing intent so the fix is not just a list of command phrases; recognize common complete viewing controls without an inference round trip. Mixed change-and-view requests must still execute the evidenced change before showing the current list.

Separate three presentation decisions: an explicit whole-list view, an actual edit of one current product, and an unchanged incidental refresh. An actual edit must not disappear into the unchanged text-summary optimization. A simple count/amount edit should show the affected product card, with full-list viewing always available. Removals should show the remaining current list. Preserve truthful unknowns and all confirmation/authorization gates.

Demonstrate failure before changing the code, then check stored state and actual native image/carousel payloads for the corrected journeys. Publish visual walkthrough evidence with the implementation. Source tests alone do not certify speech recognition or real-phone delivery. Do not deploy, replay historical commands, transfer stored customer audio, send customer test messages or alter live data in this implementation phase.

## Implementation checkpoint

The approved refinement is implemented. Explicit list viewing now uses a read-only semantic intent and current draft read, with product images/carousels despite previous delivery. Pending editing/quantity context is preserved. Known-product count/amount edits retain the affected photo, removals show the remaining list, and single-item reviews use one product image. The implementation also guards generic yes after photos from submitting an earlier bill and avoids expired approval actions.

See [implementation and limitations](/home/gk-pc/whatsapp-bot-finish/03-Output/customer-ux-review-20261020/IMPLEMENTATION.md) and the [visual walkthrough](/home/gk-pc/whatsapp-bot-finish/03-Output/customer-ux-review-20261020/evidence/walkthrough.html). Source verification is recorded with issue 48 and the pull request. User visual review, deployment approval and real-phone/fresh-speech acceptance remain separate steps.
