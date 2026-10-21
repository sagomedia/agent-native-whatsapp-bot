# Conversational cart CRUD repair — 19 October 2026

The customer requested reliable create/read/update/delete behavior in everyday speech. Issue: [#44](https://github.com/sagomedia/agent-native-whatsapp-bot/issues/44). Baseline: deployed `c30dca2`, `preview-a9682fd33831`; this is a focused follow-up to PR #43.

## Reproduced cause

The screencast shows Fevicol, the drill and the screw box surviving two explicit three-item removal requests. A read-only audit of the stored provider observations and seven-row cart confirms that the provider proposed the intended three IDs. The backend rejected Latin Tamil `eduthurunga` as removal evidence. The repeated Tamil request passed action validation but incorrectly offered the screwdriver alongside the screw box because both matched `screw`. Linked edits then waited atomically, so none executed. The follow-up prompt omitted the saved cart-edit goal and candidates.

## Change

- Recognize the recorded colloquial affirmative forms and their infinitive negations in both standalone and coordinated removals.
- Normalize screwdriver identity consistently and prevent screw edits from matching it, including through a model-supplied normalized target. Keep the existing pipe/hose identity check on that fallback path too. These checks serve delete, quantity, amount and replacement actions.
- Give the agent the current version-bound saved edit goal, linked operations, candidates and completed selections. Expired goals remain absent.
- Offer one separately reserved, metered repair for a schema-valid plan with rejected evidence and current targets. The repair sees the original transcript, rejected proposal and exact backend error. No second audio recognition or tool write occurs before validation. A second rejection, provider failure or denied repair retains a safe clarification. Stale IDs, explicit negation, malformed structure, ambiguous targets and submission gates keep their existing rejection behavior.
- Advance the understanding prompt version to `2026-10-19.3` without changing the model, persistent schema or service configuration.

## Verification

- Final focused regression: 99 passing tests covering the recorded removals, real `apply_draft_changes` receipts, every cart edit kind, add/read behavior, stale choices, negative commands, compound identity and successful/failed repair.
- Production build and typecheck pass; four catalog Python checks pass.
- Full final suite: 768 passed, zero failed/skipped; completed in 148.5 seconds.
- The two exact original stored provider observations compile locally to precisely three removals, pass current-turn validation and retain the other four rows, including the screwdriver. [Sanitized proof](recorded-observation-proof.json). This replay performs no inference, database write, tool invocation or outbound message.
- All integration fixtures use isolated schemas in a disposable local PostgreSQL database and synthetic audio/cart identities. Original customer identifiers, recordings, provider wire output and private runtime snapshots stay outside Git.

## Acceptance and release boundary

Fresh speech recognition and device acceptance remain open. Recorded observations and mocked Google transport verify planning, validation and tool execution; they do not prove accuracy on newly spoken audio. A rejected-evidence turn can make one extra text-only model call within the existing quota/budget/deadline gates. Ordinary successful turns still use one understanding call.

The fix does not execute historical deletion requests. Activation and data-preservation evidence are recorded separately after the exact candidate passes verification.
