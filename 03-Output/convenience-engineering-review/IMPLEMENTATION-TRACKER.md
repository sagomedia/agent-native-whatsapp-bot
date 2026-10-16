# Accepted implementation tracker

GitHub: https://github.com/sagomedia/agent-native-whatsapp-bot/issues/8

Branch: `codex/convenience-stock-20261016`, stacked on the preserved deployed baseline in PR #7. Base source: `2c90ece`. Keep the parent PR separate from this implementation until its overlap is reconciled.

The user approved implementation of the recommended plan on 16 October 2026, with GitHub tracking for each major change. The assessment's declined policy changes remain excluded.

| Stage | Scope | Status |
| --- | --- | --- |
| 1 | Pack/selling/price basis validation and owner preview | Implemented; build/typecheck and 30 focused integration checks passed |
| 2 | Focused missing-detail questions; native summaries/status; truthful availability; copy cleanup | Implemented; production build and all 540 integration checks passed |
| 3 | Compact final quote invoice, actual change explanation and bound delivery/approval | Implemented; build/typecheck and 73 focused checks passed |
| 4 | Stock ledger/reservations and idempotent order/amendment fulfillment | In progress |
| 5 | Owner blocker/pick-list UI, stock actions and fact-specific verification | Pending |
| 6 | Message/state gallery, Tamil copy export, browser/regression checks and release evidence | Pending |

Each stage receives a focused commit, pushed GitHub checkpoint and a validation comment on #8. Keep hosted CI results, local tests, deployment and owner/device acceptance distinct. Do not close #6 for synthetic tests or claim a bank payment was verified without actual settlement evidence.

Preserve unresolved requests, Tamil mixed with familiar English, photo comparison, estimate images, transaction/quote consent, existing order states, the ₹10 advance and the approved demo pay-at-shop exception. Existing customer data is not rewritten or retroactively deducted.

Stage 1: explicit sealed-pack versus measured-sale policy; shared title/pack/unit validation at catalog publication, cart resolution/submission and owner quotes; owner selling-basis preview. Legacy conflicts stay unpriced without rewriting saved orders. No database migration or payment change. Draft PR: https://github.com/sagomedia/agent-native-whatsapp-bot/pull/9

Stage 2: missing count questions precede product review without defaulting quantities; standard welcome/return/status replies are native text; product review ends with a native cart action outside the gallery; unchanged edits use compact summaries with Photo show; uncertain amount/cutting cases retain a focused photo. Caption copy and availability are truthful and deduplicated. Product-photo replay is read-only and version-bound. All 540 integration tests pass; transcript presentation changed with original invoice facts independently preserved. Hosted stage-1 checks also passed.

Stage 3: owner final quotes reuse compact invoice images, keep full accessible text, explain actual row and subtotal changes, show only verified advance/balance facts, and retain final-page version/delivery-bound consent. Bill change asks for a correction without taking over the conversation. Status identifies a customer-approved shop bill. Unknown quantities use a dash rather than guessed counts; Tamil quantity-column width and footer wrapping improved. Production build/typecheck and 73 focused quote/order/delivery/fulfillment checks passed. Synthetic final-invoice render visually inspected; no bank payment or live message sent.
