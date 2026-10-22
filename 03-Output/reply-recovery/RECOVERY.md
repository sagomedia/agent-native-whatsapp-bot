# WhatsApp reply recovery

Issue: #66. The user authorized immediate recovery of main VPS replies.

The latest voice message was recognized and understood, but its reply had zero transport attempts. A historical unknown multipart review blocked four unsent system notices, which then blocked an older fallback and the current reply. The old review's remaining page had already been explicitly cancelled as superseded.

A guarded transaction locked the store and affected conversation, verified the exact five never-attempted predecessor records, current operator revision, open reply window and latest response-to relationship, and saved private before/after outbox snapshots. Four historical order/payment notices were marked blocked for owner review. One stale assistant fallback was cancelled. Their payloads and original uncertain delivery evidence were retained, and the change was audited. No order/payment state or customer draft was changed.

The normal worker then sent the already-generated current reply once. Meta returned acceptance and subsequently sent `sent` and `delivered` callbacks. No assistant replies remain queued in the affected chat. See `delivery-proof.json` for the sanitized transport evidence.

The permanent sender guard reproduces this recovery only when an explicitly superseded uncertain review, never-attempted historical system backlog and a reply to the latest inbound turn all exist. It locks the conversation and records the recovery. Active reviews, same-turn/same-group ordering, attempted notices, tenant/channel scope, paused stores and owner controls retain their guards. Unknown sends are never replayed or marked delivered by inference.

The main-based feature and the combined current-VPS release both build. All 29 focused recovery, WhatsApp and concurrency tests passed on both; all 4 catalog preparation tests passed. Full-suite verification and permanent deployment are recorded in issue #66 as they finish. The customer reply has already been confirmed delivered independently of that rollout.
