# Live voice repair verification — 14 October 2026

The deterministic cart and clarification defects are fixed. **445 regressions and four catalog checks pass; the production build passes.** The unchanged live speech suite improved from 9/15 to **14/15**. Four additional customer journeys pass, including the user's original 20.22-second recording recovered from the database, a fresh five-item TTS list with a price-only follow-up, a missing pack-count clarification, and a pump-size correction. One first-pass recognition miss remains documented below.

## Acceptance taken from the previous customer tests

The customer must see the whole requested list, with supplied counts and dimensions retained. Ask one missing question, provide useful choices, preserve independently clear items during an ambiguous edit, keep prices read-only, and create one order only after current review/consent. A safe unresolved line alone does not count as a successful ordering conversation.

A read-only audit inspected 180 recent WhatsApp message rows and 65 model attempts. The original recording was read through the existing authorized VPS connection and replayed locally; no live conversation, catalog, allowance, configuration, or order was changed. Phone numbers, credentials, private history and original voice bytes are excluded from the Git changes and evidence ZIP.

## Implemented repairs

- Interpret dabba/டப்பா as a generic container. Bind its count to a matching verified whole-container selling basis, preserving uncertainty when the merchant basis is unverified. A short two-dabba reply can answer the current product question without repeating the product name.
- Preserve the literal measured pack size when a planner supplies a conflicting value. A size alone cannot become a purchase count; repeating pack contents as requestedAmount cannot manufacture one can. Explicit English articles and colloquial Tamil counts remain recognized.
- Treat a measured quantity mistakenly emitted as set_quantity/increment_quantity as an amount when the same spoken unit and value support it. Fifty metres becomes five verified 10m pieces, while fifty continuous metres remains for shop checking.
- Keep a current hose line during a length correction, including replace-shaped model outputs. Preserve unrelated lines and prevent invented rubber/colour constraints from changing identity.
- Ground numeric questions in the current spoken input as well as existing cart facts. Hold an ambiguous target, save independent valid tape evidence, and offer target buttons carrying the already spoken count.
- Recognize additional innam/இன்னம் wording, negated Tamil clear loanwords and a leading repeated consonant. A strictly non-mutating keep-list command can recover an empty intent; other invalid structures remain rejected. Zero optional target/budget placeholders are treated as absence, without allowing real stale targets or zero purchase counts.
- Keep verbatim item spans separate in punctuation-free speech. One item's paint pack/count cannot contaminate the independently counted cutter.
- A first multi-item reply acknowledges all requested items and their known sizes/counts. A bare pipe question offers bound PVC/hose/pump buttons without asking again for supplied dimensions. Choosing a type preserves line identity, quantity and dimensions; a stale choice is rejected.
- A spoken Tamil price-only request is routed to the price lookup even when the model omits its item. The price response takes precedence over an old pipe question and leaves the cart unchanged.
- Add pronunciation-only catalog/unit vocabulary to the audio understanding context. Keep the existing minimal thinking setting and allow up to 44 seconds for unified audio generation; the legacy recognizer's existing timeout remains unchanged.

## Verification

| Check | Result |
|---|---|
| PostgreSQL integration suite | 445 passed, 0 failed, 0 skipped |
| Catalog cleanup | 4 passed |
| Client/server production build and type checking | Passed |
| Unchanged synthetic speech journeys | 14/15 passed, 23 steps, 19 actual model calls |
| Original customer recording | Passed; all five items/counts and both pipe sizes retained |
| Fresh five-item TTS → pipe choice → cutter price | Passed; unchanged cart on quote |
| Missing count → spoken two-dabba clarification | Passed; count becomes two on the same paint line |
| Pump recognition miss → spoken one-inch correction | Passed; same pipe line and unchanged cutter |
| Order completion and duplicate replay | One synthetic order; duplicate event creates no second order |
| Live Meta sends / production writes | Zero / zero |

The initial suite remains unchanged; its one failed first-pass case is not relabeled as a pass. The synthetic pump voice sounds ambiguous to Gemini: it hears one inch as instant and therefore misses the requested diameter. Counts two pipes/one cutter are preserved, and no PVC or hose is substituted. A new spoken size correction restores the one-inch dimension on the same line. This is evidence of a usable recovery flow, not perfect ASR.

The controlled regression suite includes captured actual failed Gemini responses; live validation uses actual generated audio, normalizeVoice, stored voice ingress, GoogleInterpreter, ConversationRuntime, validated retail tools, PostgreSQL snapshots and bound product actions. The final verified runs use source fingerprint `7d91850c623632544d1d2ecf81bbae225a7e64922d2e841ddaabf3c6d40efbea`, prompt `2026-10-14.2`, and `gemini-3.5-flash-lite`. No model response is mocked in these live runs. Fixture-only paint and whole-hose selling verification are explicit synthetic facts, not real merchant verification.

## Original recording's current first reply

```text
நீங்கள் சொன்ன 5 பொருட்களையும் குறித்துக்கொண்டேன்:
1 inch Pipe (1 இன்ச்) — 1
0.75 inch Pipe (0.75 இன்ச்) — 1
சுவர் புட்டி சுரண்டும் கத்தி — 1
ராட்செட் PVC பைப் கட்டர் 42 மி.மீ. — 1
Asian paint 10 litre — 1
எந்த வகை பைப் வேணும் — கெட்டியான PVC, வளையும் ஹோஸ், அல்லது மோட்டார் தண்ணீர் பைப்?
```

It also displays current PVC/hose/pump type choices. The absent pump product and unverified merchant selling facts still require real catalog work; the repair does not fabricate them.

## Unchanged audio results

| Journey | Result |
|---|---|
| pump identity and independent cutter | FAILED |
| two 10L cans | PASSED |
| 10L pack with unknown count | PASSED |
| Tanglish pack count | PASSED |
| Tamil rejected PVC replacement | PASSED |
| English rejected PVC replacement | PASSED |
| extra versus total | PASSED |
| ambiguous target preserves old lines | PASSED |
| clear keep then confirm | PASSED |
| negated clear | PASSED |
| one-inch diameter and one count | PASSED |
| 50m total converts to five verified pieces | PASSED |
| continuous 50m needs shop check | PASSED |
| mild background noise | PASSED |
| full voice order and duplicate-event safety | PASSED |

## Cost and reproducibility

The final unchanged audio suite plus the four customer journeys used 26 live generation calls, estimated at **$0.040196**, with zero unsettled reservations in those runs. The unchanged 19-call suite now averages $0.001453 per call, approximately ₹0.138 at the benchmark's planning conversion. The added vocabulary increases context cost compared with the initial sample; these are estimates from the ledger, not a provider invoice.

Intermediate repair runs are retained separately, including failures, the reverted low-thinking experiment and earlier timeout reservations. They are not presented as release validation. Each final run has a $0.10 local ceiling. Original audio clips are unchanged; additional TTS texts/voices are in additional-voice-manifest.json. Runners and complete raw traces/snapshots are preserved with source hashes. The test database export omits voice bytes.

Local evidence: `/home/gk-pc/.codex/visualizations/2026/10/13/01a1364a-705d-70b1-b2f4-556b4687905a/voice-fix-qa-20261014`. `verification/summary.json`, final report.json files, run logs, source-provenance.json, unchanged/additional synthetic speech, and verified-test-database.sql support review. A separately supplied private model credential and disposable PostgreSQL database are needed for paid replay. No secret is included.

The running preview has not been updated. PR #5 remains a draft based on PR #4. This verification covers backend/media/recorded actions; a real WhatsApp device transport and owner fulfillment pilot remain separate checks.
