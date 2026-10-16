# Tamil reply review — editable wording before implementation

Review draft • 15 October 2026, America/Adak

The goal is a helpful local shop assistant speaking ordinary Tamil with familiar English words. The proposed default is Tamil script, with English words such as voice, photo, size, pieces, bill, order, advance, and ready where they feel natural. There is no English-percentage target. Latin Tanglish remains an explicit customer preference.

Every line below is proposed wording. Edit it by ID or add your preferred sentence under it. A change to wording must keep the same business meaning and action. Braced fields are trusted backend values, never model-invented amounts or states. New payment/amendment replies cannot be enabled until their backend behavior exists.

## A. What to replace in the current wording

| Current inspected wording | Why it needs review | Proposed direction |
| --- | --- | --- |
| “கடையிடம் பேசு” | Abrupt, and it means human assistance. It must not stand in for approving/sending an order. | Use “உதவி வேணும்” for a help button. Use a separate submit action with “கடைக்கு அனுப்பவா?” in its body. |
| “உங்கள் … கோரிக்கை கடையின் ஒப்புதலுக்காகக் காத்திருக்கிறது.” | Formal phrasing for a simple status. | “Order கடைக்கு போயிருக்கு. கடை இன்னும் confirm பண்ணல.” Only when submission really succeeded. |
| “பெற்றுக்கொள்ளத் தயாராக இருப்பதாக கடை தெரிவித்துள்ளது.” | Heavy phrasing for pickup. | “உங்க order ready. கடைக்கு வந்து வாங்கிக்கலாம்.” Only after owner marks ready. |
| “தெரிந்த விலை கூட்டுத்தொகை…” / “உத்தேச மொத்தம்…” | Harder to understand; can obscure which items are excluded. | “விலை தெரிஞ்ச items மட்டும்: ₹{knownSubtotal}” plus a separate exclusion sentence. |
| “பரிந்துரைக்கப்பட்ட பொருள்” | Describes the system instead of asking the customer to check. | “இந்த photo-ல இருக்குறது சரியா?” or “இது வேற option” as appropriate. |
| “பொருளை … விவரிக்கவும்” / “எழுத்து, குரல் பதிவு…” | Formal instructions in a casual conversation. | “எந்த பொருள் வேணும்னு சொல்லுங்க. Voice அல்லது photo அனுப்பலாம்.” |
| “கடை இந்தக் கோரிக்கையை நிறைவேற்ற முடியவில்லை.” | Bureaucratic and vague. | “இந்த order-ஐ கடை எடுத்துக்க முடியல.” Add the actual reason and verified refund status if available. |

Do not do a global word replacement. “Send to shop,” “ask the shop for a price,” and “let the shop owner take over this conversation” are three different actions. Their wording and buttons must remain distinct.

## B. Fixed replies: welcome through product checking

### W01 — Welcome and voice invitation [existing welcome; new audio]

Trigger: first greeting-only message in an eligible new session. If the customer already sent an item list, process it instead of asking for the same list again.

```text
வணக்கம்! என்னென்ன பொருள் வேணும்?

Voice-ல சொல்லி அனுப்புங்க.
Text அல்லது photo அனுப்பினாலும் சரி.
```

Audio: the same welcome in natural speech, recorded once with reviewed pronunciation. Do not send a new synthesized clip on every message. Do not announce a recording-duration limit unless it matches the active backend limit.

Your revision:

### W02 — Reflect the list and start checking [existing, revised]

```text
நீங்க கேட்டது:

{numberedRequestedItems}

ஒவ்வொரு item-ஆ check பண்ணலாம்.
முதல்ல {currentItemName}.
```

Show this when it helps verify the transcript; avoid repeating the entire list after every small reply.

Your revision:

### W03 — Confirm one actual catalog product [existing, revised]

```text
*{productName}*
{brandAndSize}

இந்த photo-ல இருக்குறது சரியா?
```

Buttons: `இது சரி` / `வேற பொருள்`. A photo click confirms only its bound line and product identity. It does not approve payment or final submission.

Your revision:

### W04 — Ask product type or use [existing, revised]

```text
இந்த {itemName} என்ன வேலைக்கு வேணும்?
```

For pipe ambiguity, a more useful version is:

```text
இந்த pipe மோட்டாருக்கு வேணுமா,
இல்ல plumbing வேலைக்கா?
```

Use choices only when they are relevant and non-exhaustive. A reply such as “வேற வேலை” must remain possible.

Your revision:

### W05 — Ask one missing size [existing, revised]

```text
{itemName} எந்த size வேணும்?

{availableRelevantSizes}
```

Do not ask brand, size, quantity, and use together in one paragraph.

Your revision:

### W06 — Ask quantity [existing, revised]

```text
{itemName} எத்தனை {sellingUnit} வேணும்?
```

The unit must come from verified selling terms. A “piece” must not quietly become a metre, box, or packet.

Your revision:

### W07 — Clarify total versus extra [existing capability, revised wording]

```text
{itemName} மொத்தம் {count} {sellingUnit} வேணுமா?
இல்ல இன்னும் {count} add பண்ணணுமா?
```

Bind the response to the current line/version. Never increment from an unknown previous quantity.

Your revision:

### W08 — Rejected candidate [existing behavior to improve]

```text
சரி, இது இல்ல.

எந்த விஷயம் மாறணும் — type-ஆ, size-ஆ?
Photo இருந்தா அனுப்புங்க.
```

Ask only relevant differences and keep the rejected candidate out of the next set. If the customer already explained the difference, use that explanation instead of asking again.

Your revision:

### W09 — No exact catalog match [existing, revised]

```text
{requestedDescription}

நீங்க கேட்ட மாதிரி item இந்த list-ல கிடைக்கல.
கடைல check பண்ண வேண்டியதா வச்சுக்கலாமா?
```

This says the catalog did not resolve it. It does not say the shop definitely lacks stock. Keep the customer's own photo/description; never put an unrelated photo under this item's name.

Your revision:

### W10 — Related alternative [existing, revised]

```text
நீங்க கேட்ட exact item இது இல்ல.

இது வேற option: {alternativeProductName}
இதுவும் சரியா?
```

The customer must deliberately choose a substitute; no auto-substitution from a similarity score.

Your revision:

### W11 — Keep an unresolved line and continue [existing, revised]

```text
{itemName}-ஐ கடைல check பண்ண வேண்டியதா வச்சிருக்கேன்.

அடுத்து {nextItemName}-ஐ பார்க்கலாம்.
```

Only say this after that line was actually retained with its shop-check state.

Your revision:

## C. Estimate, advance, and submission

### W12 — Review a partial estimate [new final-review capability]

```text
*உங்க list — estimate*

{pricedItemBlocks}

*கடைல check பண்ண வேண்டியது*

{unpricedItemBlocks}

*விலை தெரிஞ்ச items மட்டும்: ₹{knownSubtotal}*
{unpricedItemNames} விலை இதுல சேர்க்கல.

இந்த list சரியா?
சரின்னா, அடுத்து ₹10 advance செலுத்தலாம்.
```

Buttons: `List சரி` / `மாற்றணும்`.

If all lines are fully priced, omit the shop-check section and use “இந்த items-க்கு estimate: ₹{estimate}.” If none are priced, use W13. Approved partial-estimate exclusions must remain part of consent.

Your revision:

### W13 — No prices known yet [new final-review capability]

```text
{numberedRequestedItems}

இந்த items-க்கு விலை இன்னும் confirm ஆகல.
கடை check பண்ணி சொன்ன பிறகுதான் bill தெரியும்.
```

Do not show a zero total. Whether a ₹10 advance is requested here depends on the merchant's explicit policy for wholly unpriced requests; the final action text must reflect that decision.

Your revision:

### W14 — Advance request [new; requires payment backend]

```text
Order-ஐ தொடர ₹10 advance செலுத்துங்க.

இந்த QR-ஐ scan பண்ணலாம்.
இதே phone-ல pay பண்ண கீழே உள்ள link-ஐ பயன்படுத்தலாம்.

{verifiedMerchantName}
Advance: ₹10
{paymentLink}

இந்த ₹10 final bill-ல கழிச்சுக்குவோம்.
```

The merchant name and link come from the configured verified payment provider. Add the reviewed cancellation/refund terms or a concise link before requesting money. The last sentence depends on approval of the advance-credit policy.

Your revision:

### W15 — Payment still being checked [new]

```text
Payment வந்திருக்கானு check பண்ணிட்டு இருக்கேன்.
Confirm ஆனதும் சொல்றேன்.
```

Only use the second sentence when durable reconciliation will actually continue. Do not ask them to pay again while the outcome is uncertain.

Your revision:

### W16 — Verified advance and actionable request [new]

```text
₹10 advance வந்திருக்கு.

Order {orderReference} கடைக்கு போயிருக்கு.
கடை check பண்ணி confirm பண்ணும்.
```

Emit after payment verification and request activation commit. Advance received does not mean shop accepted or items ready.

Your revision:

### W17 — Failed or expired payment attempt [new]

```text
இந்த payment complete ஆகல.
உங்க list அப்படியே இருக்கு.

புது payment link அனுப்பவா?
```

Only after a known failed/expired outcome. For an uncertain outcome use W15 and reconcile first.

Your revision:

### W18 — Final quote after shop check [new]

```text
கடை check பண்ணிய bill:

{finalItemBlocks}

மொத்தம்: ₹{finalTotal}
Advance வந்தது: ₹{verifiedAdvance}
இன்னும் செலுத்த வேண்டியது: ₹{remainingBalance}

இந்த bill சரியா?
```

Use only a complete, reviewed owner quote. Handle an excess advance as an excess/refund, not a negative “remaining balance.” A shop-proposed substitute must be visible and separately accepted.

Your revision:

## D. Status and the conversation after ordering

### W19 — Waiting for the shop [existing, revised]

```text
Order {orderReference} கடைக்கு போயிருக்கு.
கடை இன்னும் confirm பண்ணல.
```

Payment detail can be a separate line when asked. Do not say “paid” for legacy requests or unverified advances.

Your revision:

### W20 — Accepted and preparing [existing, revised]

```text
கடை உங்க order-ஐ confirm பண்ணியிருக்கு.
பொருட்களை எடுத்து வச்சுட்டு இருக்காங்க.
```

Include “Ready ஆனதும் message வரும்” only if the readiness notification is enabled and its delivery path is supported. Do not claim an exact time without an owner-provided estimate.

Your revision:

### W21 — Ready for pickup [existing, revised]

```text
உங்க order ready!

Order: {orderReference}
கடைக்கு வந்து வாங்கிக்கலாம்.
{verifiedPickupDetails}
```

Add any verified balance only if the final quote is accepted. Omit empty pickup fields.

Your revision:

### W22 — Collected [existing, revised]

```text
Order {orderReference} வாங்கிட்டீங்கன்னு கடை update பண்ணியிருக்கு.
நன்றி!
```

Collection does not establish full payment unless the payment ledger independently records it. Further messages can still be processed.

Your revision:

### W23 — Clarify which order/line to change [new routing]

```text
எந்த {itemOrOrderLabel}-ஐ மாற்றணும்?

{currentRelevantChoices}
```

Use this only when ambiguous. Do not ask an unnecessary question if one order and one pipe are clearly identified.

Your revision:

### W24 — Review an amendment [new]

```text
Order {orderReference}

{itemName}: {oldCount} → {newCount} {sellingUnit}

இந்த change-ஐ கடைக்கு அனுப்பவா?
கடை confirm பண்ணின பிறகுதான் order-ல மாறும்.
```

Buttons: `அனுப்பு` / `வேண்டாம்`.

Your revision:

### W25 — Amendment recorded, owner pending [new]

```text
இந்த change-ஐ கடைக்கு அனுப்பியாச்சு.
கடை இன்னும் confirm பண்ணல.

{changeSummary}
```

Do not say “quantity changed” until the effective accepted revision has actually changed.

Your revision:

### W26 — Amendment accepted [new]

```text
கடை இந்த change-ஐ confirm பண்ணியிருக்கு.

{acceptedChangeSummary}
{revisedAcceptedEstimateOrQuote}
```

If a revised price or substitute still needs consent, ask for that agreement instead of saying it is already accepted by the customer.

Your revision:

### W27 — Cancellation request [new structured lifecycle]

```text
Order {orderReference}-ஐ cancel பண்ண கடைக்கு அனுப்பவா?
கடை confirm பண்ணின பிறகுதான் cancel ஆகும்.
```

Do not trigger this for “cancel பண்ணாதீங்க.” Refund messaging follows the verified policy and state, separately.

Your revision:

### W28 — Owner help / explicit takeover [existing, revised]

```text
உங்க message-ஐ கடைக்காரருக்கு அனுப்பியிருக்கேன்.
இனி கடையிலிருந்து இங்க பதில் சொல்வாங்க.
```

Use only when full takeover actually occurred. If only a price/amendment task was created, explain that specific pending decision and keep the assistant available.

Your revision:

### W29 — Assistant resumed [existing, revised]

```text
இப்போ நான் உதவி பண்றேன்.

{currentUsefulQuestionOrStatus}
```

Refresh the active question and action bindings. Do not replay old queued edits or restart the order.

Your revision:

### W30 — New order after an earlier one [existing, revised]

```text
சரி, புது order பார்க்கலாம்.
என்னென்ன பொருள் வேணும்?
```

Only after explicit new-order intent. Preserve the earlier order and its advance.

Your revision:

### W31 — Acknowledgement only [new explicit silence outcome]

Examples: “thanks,” “சரி 👍,” “okay” after a status update, with no pending action.

**Customer-facing output: none.** Record the turn as processed with reason `acknowledgement_only`. “சரி” on a current review may be consent; “thanks, இன்னும் ரெண்டு add பண்ணுங்க” is an amendment. Neither belongs in this silent case.

Your revision:

## E. Recovery and truthful payment messages

### W32 — Could not understand voice [existing, revised]

```text
Voice தெளிவா புரியல.

{knownUnclearItemQuestionOrRetryInstruction}
உங்க list அப்படியே இருக்கு.
```

Prefer a targeted question when a reliable transcript/item remains. Ask for a new recording only when needed. Do not claim the list was retained if no list existed.

Your revision:

### W33 — Temporary processing failure [existing, revised]

```text
இப்போ இதை process பண்ண முடியல.
உங்க list அப்படியே இருக்கு.

மறுபடியும் try பண்ணலாம்.
```

Do not reveal provider errors, schema names, or internal budgets to the customer. Log those safely on the backend.

Your revision:

### W34 — Stale button or changed review [existing, revised]

```text
List மாறியிருக்கு.
புது details-ஐ ஒரு தடவை check பண்ணுங்க.
```

Attach the fresh review or choices. Do not merely display this sentence with no way forward.

Your revision:

### W35 — Stock or price changed [existing, revised]

```text
{itemName}-க்கு {priceOrAvailability} மாறியிருக்கு.

{updatedFacts}

இந்த details சரியா?
```

Invalidate old consent and payment intent as required; preserve any already verified money in its ledger.

Your revision:

### W36 — Refund pending [new]

```text
₹{refundAmount} refund செய்ய request அனுப்பியிருக்கோம்.
இன்னும் complete ஆகல.
```

Use only after the refund request is durably recorded. Do not promise a timeline that the merchant/provider has not supplied.

Your revision:

### W37 — Refund verified complete [new]

```text
₹{refundAmount} refund complete ஆகியிருக்கு.
Reference: {refundReference}
```

Only after verified provider confirmation.

Your revision:

### W38 — Shop rejection [existing status; new refund integration]

```text
இந்த order-ஐ கடை எடுத்துக்க முடியல.
{verifiedShopReason}

{truthfulRefundStatusIfApplicable}
```

Omit unknown reasons and empty fields. Do not invent alternatives or imply a refund was completed.

Your revision:

### W39 — Clear the draft [existing, revised]

```text
இந்த list முழுக்க clear பண்ணவா?
```

Buttons: `Clear பண்ணு` / `வேண்டாம்`.

This clears an editable draft only after current confirmation. It does not cancel a submitted order or clear money history. Spoken “order finish பண்ணு” must route to review/completion intent; it must not become clear, human handoff, or unreviewed submission.

Your revision:

## F. Short button labels

Use a concise label on the button and the explanation in the body. Check current channel length limits using Unicode-safe fitting, without cutting a Tamil grapheme. These proposed labels are short enough for the reviewed renderer's 20-code-point ceiling; actual API/client behavior still needs a phone check.

| Action | Proposed label |
| --- | --- |
| Product is right | `இது சரி` |
| Different product | `வேற பொருள்` |
| Review estimate | `Bill காட்டு` |
| Review is correct | `List சரி` |
| Edit current list | `மாற்றணும்` |
| Start payment | `Pay ₹10` |
| Submit confirmed amendment | `அனுப்பு` |
| Decline proposal | `வேண்டாம்` |
| Check existing order | `Order status` |
| Start a separate order | `புது order` |
| Human help | `உதவி வேணும்` |
| Confirm draft clear | `Clear பண்ணு` |

Keep the event/action semantics independent of the label. A customer typing a button's title is not a verified callback ID or proof of payment.

## G. Where to apply the approved wording

Paths are relative to `02-Build/shopbot-ai/` in reviewed commit `fccf1e39e130d565ff838fdfc28076304b551fbf`.

| Copy IDs / concern | Existing paths to update |
| --- | --- |
| W01–W11, W39: welcome, selection, quantity, missing items | `services/visual-ordering.ts`, `replies.ts`, `product-verification.ts`, `discovery-replies.ts`, `shopping-flow.ts`, `agent-assistance.ts`, `packages/contracts/language.ts` |
| W12–W18: estimate/payment | `services/tools.ts`, `visual-ordering.ts`, proposed estimate/payment services and contracts |
| W19–W22, W38: status | `services/request-status.ts`, `visual-ordering.ts`, `http/owner.ts` |
| W23–W31: after-order conversation and takeover | `runtime/conversation.ts`, `services/shopping-flow.ts`, `store-assistance.ts`, proposed amendment service, `http/owner.ts` |
| W32–W35: recovery | `runtime/conversation.ts`, `services/replies.ts`, adapters and structured error-to-copy mapping |
| W36–W37: refunds | Proposed payment/refund service and owner control routes |
| Paragraph spacing and truncation | `services/whatsapp-reply.ts`, `visual-ordering.ts`, `visual-images.ts`, `review-delivery.ts` |
| Agent-generated questions | `adapters/google-interpreter.ts`: planning, recommendation, unified understanding, and relevant media paths; share the style instruction |
| Test UI parity | `apps/dashboard/src/customer-copy.ts`, `NativeChat.tsx`, `VisualReplyView.tsx` |

The catalog covers the customer states planned for this release, not every internal error string. During implementation, inventory all reachable customer-copy branches and map each to a reviewed ID or add a new review row. Do not leave a legacy path speaking formal Tamil while the new path uses the approved tone.

## H. Review method

Read the sentences out loud as if answering a customer at the counter. Replace anything you would not actually say. Prioritize W01–W10, W12, W14, W19–W21, and W24–W25.

For a change, write: `W04 → your sentence`. For an action/meaning change, mention the intended behavior too. Example: changing “கடைக்கு அனுப்பவா?” to mean “confirm final order” affects consent and payment sequencing, not just language.

After the words are approved, verify: one clear next step, no invented facts, no unnecessary repeated list, one blank line between sections, no formal translation where ordinary Tamil/English is clearer, and the same meaning across text, audio, image, and buttons.
