# Accepted implementation tracker

GitHub: https://github.com/sagomedia/agent-native-whatsapp-bot/issues/8

Branch: `codex/convenience-stock-20261016`, stacked on the preserved deployed baseline in PR #7. Base source: `2c90ece`. Keep the parent PR separate from this implementation until its overlap is reconciled.

The user approved implementation of the recommended plan on 16 October 2026, with GitHub tracking for each major change. The assessment's declined policy changes remain excluded.

| Stage | Scope | Status |
| --- | --- | --- |
| 1 | Pack/selling/price basis validation and owner preview | Implemented; build/typecheck and 30 focused integration checks passed |
| 2 | Focused missing-detail questions; native summaries/status; truthful availability; copy cleanup | In progress |
| 3 | Compact final quote invoice, actual change explanation and bound delivery/approval | Pending |
| 4 | Stock ledger/reservations and idempotent order/amendment fulfillment | Pending |
| 5 | Owner blocker/pick-list UI, stock actions and fact-specific verification | Pending |
| 6 | Message/state gallery, Tamil copy export, browser/regression checks and release evidence | Pending |

Each stage receives a focused commit, pushed GitHub checkpoint and a validation comment on #8. Keep hosted CI results, local tests, deployment and owner/device acceptance distinct. Do not close #6 for synthetic tests or claim a bank payment was verified without actual settlement evidence.

Preserve unresolved requests, Tamil mixed with familiar English, photo comparison, estimate images, transaction/quote consent, existing order states, the ₹10 advance and the approved demo pay-at-shop exception. Existing customer data is not rewritten or retroactively deducted.

Stage 1: explicit sealed-pack versus measured-sale policy; shared title/pack/unit validation at catalog publication, cart resolution/submission and owner quotes; owner selling-basis preview. Legacy conflicts stay unpriced without rewriting saved orders. No database migration or payment change. Draft PR: https://github.com/sagomedia/agent-native-whatsapp-bot/pull/9
