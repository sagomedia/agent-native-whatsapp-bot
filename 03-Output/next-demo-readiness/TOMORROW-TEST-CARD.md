# WhatsApp customer test card — 19 October 2026

Status: prepared scenarios, **not executed**. This is a demo usability review. The existing real-merchant production pilot gate remains separate and unchanged.

## Before the session

- Use 2–3 willing Tamil/Tanglish speakers and the authorized pilot WhatsApp number. Keep all customer recordings and phone screenshots private.
- Record the exact running release, artifact fingerprint, catalog revision and enabled demo payment option. Use one release for each scored session.
- Pick actual catalog items and privately write down the expected SKU, pack/selling unit and quantity. Identify estimated versus shop-confirmed prices before judging the bill.
- Keep the owner dashboard open to Requests. Check phone-side product/invoice/QR images, not just their dashboard previews.
- Use only supplied physical counts for live stock checks. Run reservation/concurrency examples needing invented counts in an isolated test shop.
- Do not require a real payment for the demo. Pay-at-shop is unpaid; a paid claim remains unverified until genuine receipt is checked.

## Ten sessions

| ID | Customer situation | Expected behavior | Main evidence |
| --- | --- | --- | --- |
| T01 | A clear voice list of 3–5 familiar items with counts | Correct SKU/unit/count, one review carousel, invoice, explicit order submission; owner receives the request. | Original voice, selected SKUs, phone review/bill, Requests entry. |
| T02 | “Pipe” without enough type information | One short type question with applicable choices; retain other items and counts; ask diameter only if still needed. | Missing-field question and unchanged other rows. |
| T03 | Paint request with litre/kg or pack/count confusion | Show the relevant real pack and ask the missing distinction; never silently convert mass to volume or 10 L to 1 L. | Intended pack, selected SKU, invoice quantity/unit. |
| T04 | M-Seal or another item with a missing count | Ask only for the count, then continue with the saved list. | Count question, no repeated full carousel solely to ask the count. |
| T05 | Replace blade with the intended plier; then “keep these, remove the rest” | One grounded replacement, no extra duplicate. Clear keep/remove instruction applies exactly; ambiguity retains the goal and asks a specific question before linked changes. | Draft IDs/SKUs/counts before/after, natural utterance. |
| T06 | Send a new product voice request while an older order exists | Ask new/existing list, preserve that voice request, apply it after the choice without asking the user to repeat it. | Both choices, saved old order, requested new cart contents. |
| T07 | Ask only a price; then send a greeting or an irrelevant message | Answer price/pack without silently adding or checking out. Respond only when a next step is useful and legitimate. | Cart unchanged, correct price status, reasonable reply/silence. |
| T08 | Request an absent/unclear product or choose a SKU with no photo | Distinguish missing identity, absent inventory and missing photo. Show genuine choices/explicit photo fallback; preserve uncertain description for the shop when requested. | Relevant choices and truthful unknown states. |
| T09 | Checkout a 7–8-item list, view QR, choose pay-at-shop, then owner packs/readies/collects | Readable single-page eight-row invoice; no duplicate full bill text; one request in Active; truthful unpaid state; correct owner actions and customer notices. | Phone invoice/QR, dashboard states, customer pickup notice. |
| T10 | Change/cancel after submission; repeat a callback or return to chat afterward | Existing submitted snapshot retained; amendment follows approval; retries do not duplicate the request/stock change; a legitimate later message is handled. | Order/amendment versions, movement receipt where stock is known, final phone reply. |

These are **ten sessions**, not a promise that ten completed orders exist. T07 can correctly create no order. T02/T05 may need extra clarification. Failed or abandoned attempts stay in the report.

## Per-session private record

```text
Case ID:
Release / catalog revision:
Start / end:
Input type: voice / text / photo / buttons
What the customer meant:
Expected SKU(s), pack/unit and count:
Observed SKU(s), pack/unit and count:
Price status: existing shop value / indicative / unknown
Outcome: pass / fail / blocked by missing merchant fact / abandoned
Extra clarification turns:
Customer turns / actual outbound messages:
First useful reply queued / accepted / delivered time, or unknown:
AI attempts, retries and known/estimated/unknown cost:
Request appeared in dashboard? Owner next action understandable?
Tamil phrase that felt unnatural:
Unnecessary text or message:
Private screenshot/recording references:
Failure category and anonymized GitHub issue:
```

## Judge the cause, not just the final screenshot

| Failure category | Example | Likely next investigation |
| --- | --- | --- |
| Speech understanding | Speaker meant MCB; transcript changed it | Compare original voice and extracted wording. |
| Retrieval | Intended catalog SKU never appeared | Inspect normalized query, family/alias/specification constraints. |
| Selection or correction | Candidate was present but wrong row was changed | Inspect candidate selection and stable target IDs. |
| Missing shop facts | Correct SKU has no actual price/count/photo | Catalog review; do not invent facts or mark recognition wrong. |
| Presentation | Correct bill/choice is difficult on the phone | Actual WhatsApp payload, wrapping, image and next-action placement. |
| Transaction/delivery | Duplicate order, stale callback, missing request or notice | Order/version/outbox records and idempotency boundary. |

## End-of-session decision

- A silent wrong SKU/unit/count, unintended deletion, duplicate order, false verified payment or corrupted reservation blocks further rollout until repaired and replayed safely.
- Record smaller wording/layout/extra-turn issues and rank them by how often customers noticed them.
- Publish anonymized counts, open failures and the tested release in GitHub. Avoid broad accuracy claims from ten sessions.
- A successful demo review does not turn this synthetic catalog into an approved real merchant or satisfy the existing 20-completed-request production gate.
- Turn the useful utterances into consented labelled fixtures. Extend to 50–100 real voice requests with held-out cases before making larger recognition claims.
