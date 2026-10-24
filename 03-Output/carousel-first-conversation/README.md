# Carousel-first conversation refinement

Issue: https://github.com/sagomedia/agent-native-whatsapp-bot/issues/75

Restores the historical product-photo → product selection → missing count → bill → separate shop submission progression. The 2026-10-24 recording and supplied screenshots showed detached long quantity prompts, text-only correction targeting and repeated full galleries. Read-only VPS inspection confirmed the attempted compound removal was rejected by evidence validation; no removal was committed. No historical voice was replayed or submitted order edited.

Changes:
- Known products require photo selection before a missing purchase count; existing supplied counts remain intact.
- Missing counts show one real product photo with a short question and bound 1/2/5 quantity choices. Consecutive missing counts retain one-item focus.
- Product-type and correction-target choices carry their relevant photos. Unlisted entries remain explicitly labelled requests awaiting shop checking.
- Individual product selection remains possible beside an unlisted request; global approval still cannot approve an unresolved list.
- Focused edits include a bound Remove this button, including for unlisted voice terms. Evidence rejection offers visual recovery without claiming a change.
- Routine count/addition updates show affected cards with access to the full list. Complete-list delivery and approval, stale actions and separate submission consent remain enforced.
- Shorter product-name acknowledgements beside images, while retaining actual changed quantities and removal feedback.
- Preserve the literal 3M brand during display measurement translation; merchant catalog records are unchanged.

Validation: 931 integration tests passed, zero failed (164.4s), against a disposable local UTF-8 PostgreSQL database; production build/typecheck passed; all 4 Python catalog cleanup checks passed. Added product-first/count-photo, consecutive missing counts, exact action preservation, evidence rejection, unlisted-item removal/stale replay and English/Tamil/Tanglish brand tests. Updated older assertions that explicitly demanded text-only quantity/type prompts. Retained the correction, consent, delivery-proof and numeric guards. Inspected the generated synthetic visual preview.

The refinement adds no model calls, services, embeddings, database migrations or catalog writes. Speech recognition can still mishear words; visual correction is the recovery path, not an assertion about what was originally spoken. Actual WhatsApp device acceptance of this refinement remains pending after deployment. The owner's previous live mask/paint conversation reached an actual shop submission, confirming the preceding catalog repair works; this release addresses its presentation/progression follow-up.

Baseline: deployed 324aee0 plus documentation checkpoint 2dce897; main bb5e509 lacks that deployed baseline. This branch retains the earlier unmerged production changes from PRs 72 and 74. Do not deploy an older main checkout over it.

Deployed `preview-5ded7dd8f333` from implementation `1ff0022`; actual process directory and artifact hash verified, ready, zero restarts. Backup `owner-20261024T101124Z` passed restore-list validation; environment byte-identical and 0600. Before/after: 340 products, 17 orders, 721 messages, schema 46, catalog revision 1901. Both hosted implementation checks passed. PR: https://github.com/sagomedia/agent-native-whatsapp-bot/pull/76. Exact evidence: `DEPLOYMENT.json`. Owner WhatsApp acceptance remains open in #75.
