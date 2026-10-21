# Conversation review follow-up — 14 October 2026

## Plan and implementation

Base this work on PR #4's verified voice recovery source (head `2955219c07d28ec47f612e9f6b920757becbb414`). Preserve its identity/target safeguards and existing cart, catalog, confirmation, delivery and order contracts.

1. Scope negative product evidence to the actual requested identity. A declined PVC pipe must not reject a separately requested garden pipe solely because both contain “pipe”. Retain rejection of the declined product itself and ambiguous evidence.
2. Share additional/repeat/correction/removal vocabulary across adapters and quantity/amount validators. Share physical unit aliases so ltr/lt, kgs, mtr, அங்குலம் and லிட்டரு cannot silently become purchase counts.
3. Permit numeric clarification only when the number comes from current draft identity, quantity, dimensions, candidate specifications or line indices. Retain blocking of invented commercial claims. Preserve the question terminator when shortening a long target question.
4. Include backend failure feedback, the rejected proposal and real observations in unified repair context. Repair a recognized audio request from the retained transcript as text, without rerecognizing the audio or changing its source modality silently.
5. Add the additive `clear_list` model intent. It proposes a version-bound Clear/Keep action for an unsent visual cart; model intent never clears or submits by itself. Disallow item mutations in the same clear proposal. Expand scoped clear wording without treating “no more items” as “do not clear”.
6. Validate focused evidence cases, integration-level repair/clear behavior, the full PostgreSQL suite, production build and catalog checks. Keep fresh recognition and a real-device pilot as separate release gates.

The understanding schema remains version 2 with an additive intent. Prompt version becomes `2026-10-14.1` so cached provider results retain provenance. The internal repair input adds original source kind; no public HTTP route or database migration is introduced.

## Deliberate boundaries

Retain the flat versioned cart with its existing resolution states, owner verification of selling units, independent valid operations during target clarification, and strict rejection of malformed or unsafe proposals. Do not auto-confirm a unique SKU, fabricate merchant verification, activate CI without the required credential scope, add embeddings, add a reply model, or introduce MCP as part of this repair.

PR #4 is already deployed but unmerged. Review this follow-up as a delta against that branch; merge the prerequisite and this change in order. GitHub publication and VPS activation are separate. This follow-up does not modify the running service, customer records or inference allowance.

## Acceptance cases

- Rejected PVC versus requested garden/pump pipe: accept the positive identity, reject the declined identity.
- 10 ltr/lt, kgs, mtr and Tamil unit variants: retain physical size; never silently buy ten packs. Explicit two 10-litre cans retains count two.
- Numeric product/target questions: retain grounded numbers, reject unsupported numbers and commercial claims.
- Multiple Tamil/Tanglish clear phrases and polite English: recognize the intended command; negated, quoted and compound shopping commands remain protected.
- Semantic voice clear: list remains until the current displayed confirmation is selected; no handoff or order is created.
- Invalid audio proposal: second call receives exact feedback/proposal and the retained transcript as text; correct independent product succeeds without another media upload.
- Existing ambiguous targets, partial independent additions, stale approvals, stock/price checks, media delivery and owner resume regressions remain passing.

## Validation result

- Production build and TypeScript client/server checks: passed.
- Complete disposable PostgreSQL 17.6 regression suite: **418 passed, 0 failed, 0 skipped** (about 93 seconds).
- Catalog cleanup suite: **4 passed**.
- Git whitespace check: passed.
- No migrations, new dependencies, paid inference, customer sends, orders or VPS activation were performed for this follow-up.

Offline mocked tests do not claim fresh Gemini recognition accuracy or real WhatsApp delivery. Before activating a release, run representative text/audio journeys against the same source, review the current transcript and exact draft deltas, and confirm product/quantity/target/clear behavior. Preserve the running release and database/configuration backup for rollback.
