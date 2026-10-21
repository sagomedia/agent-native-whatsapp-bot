# Shared removal predicates

Tracking: [issue #42](https://github.com/sagomedia/agent-native-whatsapp-bot/issues/42). Builds on #41.

The next live test exposed a different evidence shape: the provider proposed both correct current row IDs, but each verbatim `sourceText` held only its product name. The removal instruction followed the entire coordinated list. The earlier tests used spans containing their own removal verb, so they missed this provider response. The generic validation recovery echoed the transcript and kept all four rows.

The compiler now binds a shared removal predicate only when the complete clause is covered by distinct, non-overlapping product mentions plus a limited set of coordination and removal words. Extra product names, alternative/conditional wording, another action, contradictory group counts, duplicated targets and reused spans cannot borrow its authority. Per-item name and size matching still uses each original mention. The shared verb never becomes a purchase quantity. Linked edits remain atomic while one target needs clarification.

Tamil infinitives and imperatives have separate polarity: `எடுக்க வேண்டாம்` means do not remove; `எடுத்துருங்க வேண்டாம்` means take it out, I do not want it. The infinitive prefix cannot match inside the completed imperative. Recognition's `4 in` abbreviation is normalized only for edit-size comparison, preserving purchase-count extraction.

The provider prompt describes this representation explicitly; version is `2026-10-19.2`. No schema, price, stock, payment, order-submission or dashboard changes are required. Customer replies reuse the existing updated-cart review; no new deterministic copy is introduced.

Regression coverage includes the captured response shape with anonymous row IDs, an unknown adhesive quantity, a screw-size contradiction, omitted/duplicate targets, true negations and conditional clauses. Integration tests pass the response through the actual Google adapter, normalized voice ingestion, runtime transaction, and serialized outgoing carousel. A second case resolves one target before applying both removals, without another inference. The returned carousel must contain only the two remaining rows, never a transcript echo.

Release verification must replay the recorded provider observation read-only against current state, preserve the current cart and catalog, verify the native backup and readiness, and record final test/CI results in #42. Historical voice messages are never executed during deployment. Fresh audio recognition remains a live customer acceptance check.
