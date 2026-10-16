# Accepted implementation tracker

GitHub: https://github.com/sagomedia/agent-native-whatsapp-bot/issues/8

Branch: `codex/convenience-stock-20261016`, stacked on the preserved deployed baseline in PR #7. Base source: `2c90ece`. Keep the parent PR separate from this implementation until its overlap is reconciled.

The user approved implementation of the recommended plan on 16 October 2026, with GitHub tracking for each major change. The assessment's declined policy changes remain excluded.

| Stage | Scope | Status |
| --- | --- | --- |
| 1 | Pack/selling/price basis validation and owner preview | Implemented; build/typecheck and 30 focused integration checks passed |
| 2 | Focused missing-detail questions; native summaries/status; truthful availability; copy cleanup | Implemented; production build and all 540 integration checks passed |
| 3 | Compact final quote invoice, actual change explanation and bound delivery/approval | Implemented; build/typecheck and 73 focused checks passed |
| 4 | Stock ledger/reservations and idempotent order/amendment fulfillment | Implemented; production build, 31 focused tests and upgraded-schema preservation check passed |
| 5 | Owner blocker/pick-list UI, stock actions and fact-specific verification | Implemented; build/typecheck and 19 owner/upgrade checks passed; browser review follows |
| 6 | Message/state gallery, Tamil copy export, browser/regression checks and release evidence | Implemented and deployed; all 553 integration checks, four Python checks, desktop/mobile browser review and both hosted CI checks passed |

Each stage receives a focused commit, pushed GitHub checkpoint and a validation comment on #8. Keep hosted CI results, local tests, deployment and owner/device acceptance distinct. Do not close #6 for synthetic tests or claim a bank payment was verified without actual settlement evidence.

Preserve unresolved requests, Tamil mixed with familiar English, photo comparison, estimate images, transaction/quote consent, existing order states, the ₹10 advance and the approved demo pay-at-shop exception. Existing customer data is not rewritten or retroactively deducted.

Stage 1: explicit sealed-pack versus measured-sale policy; shared title/pack/unit validation at catalog publication, cart resolution/submission and owner quotes; owner selling-basis preview. Legacy conflicts stay unpriced without rewriting saved orders. No database migration or payment change. Draft PR: https://github.com/sagomedia/agent-native-whatsapp-bot/pull/9

Stage 2: missing count questions precede product review without defaulting quantities; standard welcome/return/status replies are native text; product review ends with a native cart action outside the gallery; unchanged edits use compact summaries with Photo show; uncertain amount/cutting cases retain a focused photo. Caption copy and availability are truthful and deduplicated. Product-photo replay is read-only and version-bound. All 540 integration tests pass; transcript presentation changed with original invoice facts independently preserved. Hosted stage-1 checks also passed.

Stage 3: owner final quotes reuse compact invoice images, keep full accessible text, explain actual row and subtotal changes, show only verified advance/balance facts, and retain final-page version/delivery-bound consent. Bill change asks for a correction without taking over the conversation. Status identifies a customer-approved shop bill. Unknown quantities use a dash rather than guessed counts; Tamil quantity-column width and footer wrapping improved. Production build/typecheck and 73 focused quote/order/delivery/fulfillment checks passed. Synthetic final-invoice render visually inspected; no bank payment or live message sent.

Stage 4: schema 35 adds exact fractional on-hand/reserved/available stock, an auditable movement ledger and revision-bound order holds. Acceptance reserves atomically; revised accepted orders adjust holds; collection consumes once and cancellation releases once. Owner stock-count/restock/walk-in endpoints use idempotency and stale-version guards. Catalog saves cannot overwrite changed counts or change a reserved selling basis. Existing orders migrate as legacy with no stock deduction. Production build and 31 focused tests passed; full run passed 547/548, then the v26 downgrade fixture was updated for schema35 and its preservation test passed. Final full regression remains required after owner/gallery work.

Stage 5: owner requests show their next blocker and a photo pick list, current physical/reserved/available stock, explicit earlier-order reconciliation and untracked items. Ready status requires a physical products/count/pack check bound to the effective revision; an approved amendment or revised bill invalidates previous packing readiness. Owner stock tools record received stock, walk-in sales and corrected counts with reasons/history. Saved merchant confirmations survive unrelated edits; dependent facts are rechecked. Production build/typecheck and 19 owner/UI/upgrade checks passed, in addition to 31 stock/order checks earlier in this stage. Final browser/full regression follows.

Stage 6: authenticated message review uses actual shopping, invoice, quote, payment and status renderers with synthetic fixtures only. Tamil/Tanglish/English controls and stage filters are available; preview actions are disabled. Shared caption composition preserves WhatsApp deduplication and Tamil grapheme boundaries. Fixed voice/refund text is reused rather than copied into a mockup. Tamil source inventory regenerated (560 entries). Seventy-two focused checks and the complete owner browser flow passed; stock endpoint/audit and read-only gallery tests cover the last browser findings. Sequential full regression and packaged release verification remain in progress. Deployment requires the locked VPS key; no new live messages or bank settlement is claimed.

Final verification: source `7bdb45a` deployed as `preview-ee77b7c4ba47` with artifact `58fef78a9699b8c32e4f7a448e77e8377d70c05a793ccb2961f16c0db26b532d`, schema35. All 553 sequential integration checks passed with zero failures/skips; four Python checks passed; desktop1440/mobile390 browser flow and Tamil/Tanglish/English message review passed without page errors or overflow. Both hosted push and PR checks passed for that source. Fresh private backup and offline fingerprints verified all 20 checked tables; historical orders/catalog/media/payments/budget records were preserved, no old stock was deducted, and environment/demo-payment settings were unchanged. Detailed evidence is in `evidence/` and `RELEASE-HANDOFF.md`. The implementation PR remains reviewable and unmerged; #6 retains actual owner/device/bank acceptance.

Deployed read-only smoke also passed against the real catalog/owner snapshot and Tamil gallery using database-enforced read-only sessions; inventory availability fields and preserved live feature flags were verified. The dedicated MCP role can read the new stock columns and cannot insert ledger movements. No diagnostic customer order, WhatsApp message or payment was created.
