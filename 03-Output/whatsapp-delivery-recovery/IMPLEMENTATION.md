# WhatsApp outbound recovery — 19 October 2026

Tracking: [issue #38](https://github.com/sagomedia/agent-native-whatsapp-bot/issues/38). Builds on the deployed owner dashboard changes in #37.

## Confirmed failure

Two inbound voice messages reached the webhook and were transcribed and processed. The first generated a two-part review. Its first page entered `unknown` with `network_outcome_unknown`, no provider ID, and no signed receipt. The next customer turn invalidated the old review's action page and queued a fresh new/existing-list question. The old unknown page still blocked every later reply in that conversation.

The API remained ready; sending was enabled; the channel was not authentication-blocked. Three later read-only Graph probes returned HTTP 200. The old catch discarded the original exception, so DNS failure, connection failure, reset and deadline expiry cannot be distinguished retrospectively. A successful later probe does not establish whether the original message was accepted.

## Change

1. When a review becomes obsolete, cancel every **unsent** assistant page in its group, including pages without their own buttons. Keep attempted messages and original error evidence intact.
2. Allow an assistant reply from a **later inbound customer turn**, in a **different group**, past an unknown assistant page only when the old group contains a page explicitly cancelled as `review_superseded`. In-flight sends, current review groups, same-turn continuations, owner/system messages and unrelated cancellation reasons retain the existing ordering barrier. No uncertain original is retried or marked delivered.
3. Retry only errors known to precede an HTTP connection: DNS resolution, connection refusal/unreachability and Undici connection timeout. Use 10/20-second delays and at most three attempts. An abort deadline, connection reset, generic failure or mixed/empty aggregate remains unknown. Store only allowlisted machine codes, never raw exception messages or credentials.
4. Treat a malformed successful HTTP response as unknown. HTTP 200 without a valid message ID must not be mistaken for Meta permission error code 200 and disable the whole channel. Database failures propagate to durable recovery rather than being mislabeled as network errors.

Current invoice delivery/approval checks, recipient allowlists, the 24-hour service window, owner pause/takeover revisions and late signed-status reconciliation remain enforced. An active ambiguous send still requires reconciliation; a later customer message alone does not prove delivery. This change is intentionally conservative about when an obsolete review can release a new reply.

Error classification follows the documented distinction between [Undici connection and socket errors](https://github.com/nodejs/undici/blob/main/docs/docs/api/Errors.md) and [Node system error codes](https://nodejs.org/api/errors.html#common-system-errors). No new dependencies, schema changes, price changes or inference calls are needed.

## Validation and live recovery

- 65 focused PostgreSQL tests pass, covering the reproduced multipart blockage, text-only stale pages, late receipts, retry limits, uncertain resets/deadlines, same-turn/group barriers, current invoice approval, concurrency and owner controls. Typecheck/build pass.
- The complete suite and GitHub checks are required before release completion.
- Activate through the native verified release/backup path. The already-queued legitimate customer question should then be picked up once by the normal sender. Do not manually replay the old unknown page or its cancelled action page.
- Verify a signed `delivered`/`read` status for the recovered message. `queued`, `accepted`, dashboard rendering and API readiness alone do not prove receipt on the customer's phone.
- Private incident evidence remains outside GitHub. Original product facts, photo bytes, orders and environment must be preserved.
