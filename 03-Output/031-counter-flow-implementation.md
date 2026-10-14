# ShopBot counter flow — local implementation, 14 October 2026

The first implementation slice repairs the conversation defects reproduced in the [review and implementation plan](030-shopbot-reviewed-implementation-plan.md). Product identity approval can precede a missing count. A customer must then see a complete bill and give separate consent before an immutable order request is created. Price-only questions retain the draft and its current question.

This is a local source change on `codex/reconciled-counter-flow`, based on reviewed commit `2403f76e0c770b9217fc191d2dc88ff8581560d3`. It preserves the separate shared checkout and its uncommitted work. The original chat checkout was `fccf1e39e130d565ff838fdfc28076304b551fbf`. The source includes the existing WhatsApp, owner, inventory and voice modules. The earlier browser fixes were reconciled by customer behavior and regression coverage rather than applying their entire patches over newer quantity/target repairs.

## What changed

| Customer situation | Result |
|---|---|
| “10L white paint” without a count | Product details can be checked, but the missing quantity remains explicit. No finish-order action or complete zero bill is offered. |
| Two different pipe sizes in one list | The active pipe can reach its SKU choice before a later pipe's type question. The next question retains its structured diameter. |
| “Price of the cutter” during pipe selection | A short native price/stock answer is sent. No draft mutation, false conversion warning, quantity action or old pipe question is appended. |
| A genuine quantity/conversion quote | The product name, catalog unit price, requested amount, verified total and stock remain visible. Unverified conversion retains its warning. |
| “Send it” before the list is complete | The bot returns the required customer question. Shop handoff requires an explicit request for shop help. |
| Product review is accepted | A complete priced list opens the bill; a count or unit blocker opens its question. This does not submit an order. |
| The displayed bill is confirmed | One immutable request is submitted. Duplicate confirmation cannot submit twice. |
| A product is explicitly marked free | A legitimate ₹0 bill is permitted and still requires separate final consent. An unverified zero price remains blocked. |
| “Keep my list” or a negated clear | All lines remain. Existing Tamil/Tanglish refusal and correction protections continue to apply. |

The new `counter-state.ts` derives blockers and quoting capability from existing line facts. It adds no persisted draft status or migration. Product identity functions now live in a small independent module so the derived state and presenters do not introduce an import cycle. Identity review coverage and bill readiness are separate checks; persisted `matched` remains compatible with the existing database.

Presentation changes are deliberately small: a single price answer uses native text, variant choices retain product cards, and the final bill retains the existing itemized visual format. Nonvisual discovery/quotes keep their explicit product-selection cards. A `readOnly` reply flag prevents pending-draft prompts from contaminating these independent answers.

## Timing and accounting

The SDK and runtime now share timing constants. Audio and visual interpretation receive up to 45 seconds per call; the SDK audio deadline is 44 seconds. Ordinary text receives up to 12 seconds. Each processing claim has a 120-second inference deadline and a 135-second lease, leaving 15 seconds for saving the result. Subsequent calls are capped by the remaining claim time. The deadline is rechecked after reservation and settlement and before shopping effects; the final transaction also requires the original claim token and an unexpired lease.

Five focused tests use offline transports and a simulated inference clock. They establish that a 25-second audio response succeeds, a timeout retains its unknown paid reservation, three stages cannot exceed their shared claim deadline, an expired worker cannot save shopping effects/replies, and the SDK uses one transport attempt with the intended audio timeout. The accounting test marks its fake provider as live only to exercise the ledger; it has no network transport and spends no money.

Existing rate snapshots, budget limits, unknown-cost holds and retry rules are preserved. This slice does not reduce the million-token conservative reservation, extend rate validity, change currency units, or implement Meta allowance reconciliation. The deadline is scoped to a processing claim; queued or deferred stages may be resumed in a later claim. A durable deadline spanning queue deferrals, DB statement bounds and explicit rendering/decode admission still belong to the remaining P2 work.

## Customer transcript

The [saved six-reply transcript](../02-Build/shopbot-ai/tests/fixtures/counter-five-item-transcript.json) checks visible text, product/instruction captions, bill rows and total, and the action labels/events emitted by the WhatsApp renderer. Stable IDs, clocks and image hashes are excluded. It records this synthetic journey:

1. Retain all five requested lines and ask which type of **1-inch pipe** is needed.
2. Choose PVC; show the two matching 1-inch SKUs.
3. Ask the cutter price; answer **₹350** without changing the pending pipe choice.
4. Select H01; ask the type of the **0.75-inch pipe**.
5. Choose PVC; review all five identified products.
6. Approve those products; show all five bill rows and the **₹2,040** catalog estimate, with a separate Send to shop action.

The test then confirms the bill and repeats the identical confirmation event, asserting that exactly one five-line request exists. Separate tests cover missing paint count, early send, refusal, read-only price and the explicit-free-price exception.

The paint and scraper are explicitly synthetic merchant facts under `PAINT10` and `COUNTER-SCRAPER-4`; they have no falsely borrowed demo photo. Actual demo H15 is a cutting wheel and H20 is a measuring tape. This fixture validates workflow behavior, not a merchant's actual paint/scraper availability or photos. Existing saved Tamil/Tanglish perception fixtures remain in the full regression suite; the new complete five-item transcript is English. This is renderer/contract evidence, not a real phone delivery or acoustic accuracy evaluation.

## Verification

The final source passed all **458 integration/regression tests**, with zero failures or skips, the production build and TypeScript checks, and all **four Python catalog cleanup tests**. The suite includes the original 445 cases plus eight new customer journeys and five timing/accounting checks.

Final results and source hashes are recorded in [verification metadata](031-counter-flow-evidence/verification.json), with the [build log](031-counter-flow-evidence/build.log), [integration log](031-counter-flow-evidence/integration.log), [journey checks](031-counter-flow-evidence/journey.log) and [catalog checks](031-counter-flow-evidence/catalog.log).

The environment uses Node 22.22.1, locked npm dependencies, FFmpeg and a disposable PostgreSQL 17.6 database with temporary test schemas. The integration command now limits test-file concurrency to four; the unrestricted run overloaded the shared machine. Tests use synthetic data and offline AI/Meta transports. No production database was queried or changed, no customer message was sent, and no application was deployed.

The original reviewed 445 test cases are retained. Tests that previously expected submission straight from product review now assert product approval → bill → separate consent; their duplicate protection, draft retention, stock, voice evidence and owner-control assertions remain. The first broad run caught price/detail and focused-choice regressions, which were repaired. A new free-price test also exposed a missing bill-image field in the transcript helper; the helper now includes rows and total.

The [CI workflow](../.github/workflows/project-checks.yml) is adapted from the repository's earlier proposal. It runs build, the integration suite and catalog checks with a disposable PostgreSQL service and disabled live inference. The v4 [checkout](https://github.com/actions/checkout/blob/v4/README.md) and [setup-node](https://github.com/actions/setup-node/blob/v4/README.md) inputs were checked against the maintainers' documentation. The workflow exists locally; no hosted run has occurred for this branch yet.

## Plan status and next work

| Package | Status in this slice |
|---|---|
| P0 source reconciliation | Local branch, preserved shared work, locked build/test environment, root documentation corrections and conventional CI workflow. Hosted review/checks remain pending publication. |
| P1 release regressions | Eight new journey checks plus retained voice/OCR/current-target regressions. Native renderer action bindings and itemized bill content are asserted. Live phone and acoustic tests remain separate. |
| P2 timing and cost | Shared call/claim deadlines, lease checks and five new timing/accounting regressions. Rate freshness/grace, admission/reservation bounds and channel billing ledger remain outstanding. |
| P3 line progression | Derived blockers, product coverage independent of quantity completeness, focused pipe progression, named measures, early-send behavior and separate bill consent implemented without migration. |
| P4 perception | Existing evidence guards preserved; robust multi-hypothesis understanding and broader Tamil/Tanglish acoustic/OCR evaluation still pending. |
| P5 reply planning | The price and ordering presentation defects are repaired. A unified reply-plan abstraction and broader layout review remain pending. |
| P6 merchant catalog | Explicit synthetic regression fixtures only. Real merchant sample verification, selling bases, images and audit/import work remain pending. |
| P7–P10 rollout, pilot, MCP, public number/payment | Detailed in the reviewed plan. CI source is prepared; deployment/pilot and the remaining integrations have not been performed. |

The next code package is the rest of P2: bounded multimodal admission, a tested rate freshness policy and an additive delivery-pricing ledger. Then complete the reply-plan/perception work with merchant-verified fixtures before a controlled phone pilot. Preserve existing provider attempts, holds, immutable requests and retained media when upgrading. No draft migration is required for this first slice.
