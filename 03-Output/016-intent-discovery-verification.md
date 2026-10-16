# Intent-led discovery verification — 4 October 2026

The English simulator controls are separate from the bot reply preference. Tamil remains the default; English/Tamil/Tanglish product descriptions are understood independently. Existing replies retain their own product-card language.

The reported pipe-cutter error is fixed: the 42mm regex could backtrack to part of the number and exclude H19, returning a reducer alias instead. Unique catalog identities use their actual specifications; numeric units stay whole. Whole keyword phrases and valid family alternatives prevent incidental shared-word matches. The model can compare all 30 demo products and propose keywords, relevant types and a bounded ordering of real SKUs. SQL scope and hard filters remain authoritative.

109 isolated integration/regression tests pass under Node 22.22.1. The production container build, typecheck and deployed readiness pass. Regression cases cover the actual wrong cutter proposal, misspelled English and Tamil lookup, six distinct useful cutting choices, constrained SKU ranking, remembered quantities/units, current zero-call refinements/rechecks, historical language, question punctuation, and the live model's mistaken add/default-quantity decision. Existing voice, image, consent, budget, stale-message and multi-store tests remain passing.

## Live synthetic checks

| Case | Observed result |
| --- | --- |
| Reported Tanglish cutting-blade wording | Four real photos and a practical Tamil job question; read-only |
| Same wording after quantity retention | Remembered one piece; selecting H14 reached a separate ₹35 review with no extra model call |
| English unknown-cutter description | Six real options in one reply, a Tamil job question, empty draft |
| Initial English plastic-pipe follow-up | Correct H19 identity, but model proposed an unstated quantity of one; this exposed the regression and prompted the exploration guard |
| Final guarded English 25mm plastic-pipe follow-up | H19 only, actual 0–42mm catalog specification, Tamil photo-confirmation question, empty draft and no amount assumed |

Five guarded Gemini free-tier requests used 45,836 reported tokens. All five completed wire validation; one revealed a semantic mistake that was fixed and regression-tested. Zero order requests were submitted. The running container is Node 22.22.1, ALLOW_PAID_INFERENCE=false, AI_BUDGET_USD=0 and ALLOW_FREE_INFERENCE=true. Known product selection, browsing and rechecks do not consume new inference. No automatic provider retries or paid fallback were added.

The planner evaluates existing real catalog observations in one model call; deterministic retrieval then rechecks them. This is not a second model pass over final SQL rows. Technical fit remains tentative until the merchant verifies material, tool/machine compatibility and capacity data. A small catalog may correctly provide only one relevant item. The local carousel is still a preview; real WhatsApp transport/template approval is a later phase.

The explicit test conversations, provider plans and states are in 016-live-intent-proof.json. Screenshots: 016-six-options.png, 016-quantity-preserved.png and 016-intent-followup.png. Source explanation: 02-Build/shopbot-ai/INTENT-DISCOVERY.md. Local rollback image: shopbot-ai-before-intent.
