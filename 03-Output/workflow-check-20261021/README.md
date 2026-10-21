# ShopBot complete workflow check and simpler teaching

21 October 2026. Follow-up to the dashboard usability candidate. [Function-by-function matrix](FUNCTION-MATRIX.md) · [Short operator teaching guide](OPERATOR-GUIDE.md) · [Verification record](VERIFICATION.json).

The complete automated suite passes **842/842, zero skipped** on UTF-8 PostgreSQL. Build/typecheck, four Python catalog checks and expanded browser workflows pass. A separate real local API run verifies the built application against an isolated synthetic database. No live customer messages, AI calls or money transfers were made.

## Workflow problems fixed

1. Resolve could send focus to price when the actual problem was an out-of-range quantity or explicit free confirmation. It now focuses the exact invalid fact with linked error text.
2. A pack/loose decision could be omitted until the server rejected send; its selector also disappeared after choosing. It is now checked before send and stays editable.
3. Unknown stock invited a receive/sale attempt that could only fail. It now opens the physical count and explains what to count.
4. Clearing one bulk input could leave a blocking empty edit or force removal of another valid fact in that row. It now means no change to that field.
5. Off-page edits and partial batch recovery were difficult to follow. Pending names are visible; saved rows are labelled, and Reload remaining products preserves committed rows while refreshing only the unsaved edits.
6. A customer cancellation said only Accept change. It now says Accept cancellation and confirms the actual cancellation/hold-release effect.
7. Receipt and refund could share one input value. They now have separate fields; recording a refund requires its actual reference and explains that it does not send money.
8. Offered quotes could say sent even when WhatsApp was unavailable. The banner now says saved/awaiting approval, and a lost send response can recover the recorded quote without claiming delivery.
9. An unconnected chat could foreground a closed reply window instead of the disabled channel. The blocked composer now names disabled sending first.

The **? Quick help** button adds optional English/Tamil instructions for quoting, pickup, price/stock and customer replies. Each guide can open the correct task. It does not add a mandatory tour or extra daily-work step. [Phone help screenshot](evidence/tasks/quick-help-phone.png).

## What is and is not verified

The matrix covers the dashboard's existing jobs and important exception paths. Browser checks include photos/aliases, draft reload/clone/publication/hiding, real-field focus, quote-to-collection, manual-send response loss/window closure, stock/price retry identity, partial batch recovery, cancellation/advance/refund, settings, previews, language and access recovery. The real local API check uses real services with synthetic data; external providers are disabled.

The earlier 838/840 report needs correction: the two failures came from the local test harness's SQL_ASCII database encoding. Both affected files pass 42/42 on UTF-8; the complete current suite passes 842/842. The previous hosted source check was already green. No conversation tests were weakened to obtain this result.

Actual handset delivery, bank/payment-provider settlement, physical keyboard/safe-area/zoom/screen-reader checks, old-device/network speed, native Tamil copy review and novice learning success remain separate acceptance work. There is no completed human learning study. The operator guide defines a short demonstration and four unassisted practice jobs so the next check has a concrete pass condition.

[Updated synthetic local preview](http://127.0.0.1:3044/owner?view=overview) is available while the preview/database processes run. This candidate remains **not deployed**. Current review: [PR #54](https://github.com/sagomedia/agent-native-whatsapp-bot/pull/54); acceptance tracking: [issue #52](https://github.com/sagomedia/agent-native-whatsapp-bot/issues/52).
