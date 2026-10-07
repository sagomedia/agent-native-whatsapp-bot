# Project Review And Customer-Cost Benchmark
Date: 6 October 2026. Latest read-only VPS audit: 04:12:21 UTC / 09:42:21 IST.
Active release: preview-d385c6bec164. Scope: architecture, Tamil-first customer service, agent behavior, costs and public WhatsApp readiness.

Application code, live configuration and customer records were not changed for this review. Audit made zero model calls and zero WhatsApp sends. Normal customer traffic continued independently. Dollar amounts below are USD estimates, not invoices or remaining Google credit.

## 1. Benchmark First

### Recorded AI costs
| Input | Sample | Estimated AI cost per input |
| --- | --- | --- |
| Text recognition, retained evaluation | 4 inputs | $0.00071050 average |
| Product photo, retained evaluation | 9 inputs | $0.00082611 average |
| Voice, retained evaluation | 11 inputs | $0.00087236 average |
| Voice, production ledger | 9 paid inputs | $0.00111444 average, including historical failures/recommendation |
| Two previously verified complete voice + recommendation turns | 2 turns | $0.001278 and $0.001569 |
| Verified shopping buttons/quantity/confirmation | Deterministic handlers | No additional Gemini call |

Retained evaluation has 25 settled paid inputs and 26 settled paid attempts. Unknown outcomes are excluded from averages. These are small, mixed-version samples, not population accuracy, current-release cost guarantees or the average bill for one finished customer.

An illustrative journey containing one two-stage voice turn, one photo and one text clarification costs approximately $0.002815-$0.003106 in AI, before messaging, infrastructure, human service, tax or FX. At 1,000 such journeys that is approximately $2.82-$3.11 AI-only. Different numbers of media and typed follow-ups change the result. A customer abandoning the list still incurs costs.

Current production ledger: $0.011845 estimated committed, $0 held, $4.50 cumulative application cap. Retained evaluation: $0.019873 estimated committed, $0.414516 conservatively held for unknown outcomes, $0.50 cap. Combined recorded estimates: $0.031718. Holds are not verified charges; do not release them without evidence. The application ledger does not include other programs using the same API project.

Production historical invalid model responses cost $0.002977, about 25.1% of estimated production spend at this snapshot. This is past debugging waste, not a forecast failure rate. Three recommendation calls total $0.001783. The second stage accounted for about 40-44% of the cost of the two documented voice turns above; it should earn its place by improving resolution.

The configured model is Gemini 3.5 Flash-Lite. Published Standard pricing is $0.30 per million input tokens and $2.50 per million output tokens including thinking. Audio, image and text share that input rate in the configured rate card. No local speech model, TTS or search-grounding service is used in this workflow.
Source: [Google Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing).

### Delivery and performance
- One real test WhatsApp conversation, 54 inbound messages, zero waiting at the latest snapshot.
- 52 delivered outbox records, one historical Meta 131009 failed record, two owner-control cancellations. Delivery records include recovery/history and do not measure recognition accuracy or completed orders.
- Voice reply generation: n=11, median 8.825 seconds, historical p95 19.302 seconds. Photo: n=1, 10.568 seconds.
- Text median: 2.610 seconds. Historical p95 about 74.5 minutes includes owner pause/deployment backlog and must not be presented as a fresh online-response SLA.
- Thirteen processed commerce-control events have no live inference attempt. Two failed voice inputs also had no inference; those are failures, not efficiency wins.
- Prior local isolated 10,000-SKU test observations: 73 ms focused run and 98 ms under the full suite, retrieving at most 120 candidates and returning 10. These are local single-query observations, not VPS load or p95 measurements.
- Full isolated regression suite passed 163/163. Retained deployment evidence includes the passing suite and build/typecheck. Mock provider tests do not prove real Tamil perception or public Meta delivery.

### Every operating-cost category
| Category | Verified / unknown | What to account for |
| --- | --- | --- |
| Gemini recognition and recommendation | Estimated from usage ledger | Successful calls, invalid outputs, retries and unknown outcomes |
| WhatsApp delivery | Test analytics only | Per delivered category, destination market, account currency, current allowances and templates |
| BSP/provider platform | Direct Meta API in code | No BSP visible in this implementation; confirm external contracts |
| VPS compute | e2-micro in us-central1-a | Free-tier eligibility depends on shared billing-account allowances |
| Disk/database | 10 GB standard persistent disk, PostgreSQL on same VM | Eligible free allowances, growth, backups and snapshots |
| External IPv4 | Present on current VM | List price $0.005/hour; roughly $3.60-$3.72/month after the one-hour allowance, before credits/tax |
| Network/media hosting | Not invoiced in this audit | Egress, destination exclusions, image delivery, tunnels and overages |
| Domain, Cloudflare and merchant phone | Account invoices not checked | Renewal, plan fees, SIM/phone service and shared allocations |
| Retention, observability and backups | No total-cost ledger | Storage, logs, offsite encrypted backups, restoration tests |
| Human service | Not measured | Handoffs, corrections, acceptance, fulfillment and owner minutes |
| Onboarding/maintenance | Not measured | Catalog capture/cleanup, merchant training, support and updates |
| Taxes and FX | Not verified | Actual billing currency, GST/tax and conversion/transaction charges |

GCP free-tier eligibility is not an invoice guarantee. The existing $5 AI credit does not cover all these categories.
Sources: [GCP free-tier limits](https://cloud.google.com/free/docs/free-cloud-features), [External IPv4 pricing](https://cloud.google.com/vpc/network-pricing).

Meta's dated official update says service messages and in-window utility messages become chargeable from 1 October 2026. Some overview wording still describes older free rules. Do not assume unlimited free WhatsApp messaging. The corrected display-number pricing-analytics query returned two points totaling 53 messages and cost 0 for the current TEST account. That is not a production-number quote, an invoice or a future allowance guarantee. The actual production account rate card, currency, allowance and billing statement still need verification.
Sources: [Meta dated non-template pricing](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing/non-template-messages.md), [Meta analytics](https://developers.facebook.com/documentation/business-messaging/whatsapp/analytics.md).

All-in customer cost = AI + delivered-message fees + provider fees + variable storage/egress + fixed monthly costs / customer journeys + owner minutes * hourly rate / 60 + onboarding/maintenance allocation + applicable tax/FX.
Accepted-order cost must include abandoned chats and be divided by accepted orders, not only completed bot conversations. Real conversion and average human minutes are not established.

For scale intuition, IPv4 alone is about $0.036 per journey at 100 journeys/month, $0.0036 at 1,000, and $0.00036 at 10,000. These are allocations, not complete operating costs.

## 2. Findings, Ordered By Risk

### P1: Rejected WhatsApp replies can leave the customer seeing typing and then silence
The sender records definitive API rejection as failed and ambiguous network outcomes as unknown, without automatic customer recovery or an owner alert. The observed duplicate-button Meta 131009 incident was fixed and manually recovered; generic recovery remains missing.
Code: [Sender failure handling](/home/gk-pc/.codex/worktrees/customer-experience/2026-10-agent-native-whatsapp-bot/02-Build/shopbot-ai/apps/server/src/services/whatsapp-channel.ts:228).
Improve: validate all outbound contracts, provide one zero-AI plain-text recovery only after definitive rejection and safe current-state checks, surface overdue/failed sends to the owner. Never blindly resend an unknown send outcome.

### P1: Human handoff and order acceptance do not complete the customer-service loop
Owner accept/reject explicitly returns customerNotification: not_sent. Handoff changes operator mode but does not itself provide a push alert, response deadline or verified follow-through. Customer copy can imply shop notification even when only dashboard state changes.
Code: [Owner decision](/home/gk-pc/.codex/worktrees/customer-experience/2026-10-agent-native-whatsapp-bot/02-Build/shopbot-ai/apps/server/src/http/owner.ts:134), [Handoff](/home/gk-pc/.codex/worktrees/customer-experience/2026-10-agent-native-whatsapp-bot/02-Build/shopbot-ai/apps/server/src/services/shopping-flow.ts:44).
Improve: an owner work queue and alert, acknowledgement/response SLA, Tamil customer notification for accepted/rejected/pending status, window-safe approved templates when necessary, and explicit bot resume. Never claim paid, ready or stock reserved from a request submission.

### P1: Demo catalog cannot serve as merchant inventory truth
Live store is synthetic with 36 active products, 17 families, 30 photos and 30 Tamil names. It includes 30 demo products and six fixtures, with unresolved source/brand/price/unit conflicts. Popular requested items are absent. Stronger language generation cannot establish absent stock.
Code: [Demo-only importer](/home/gk-pc/.codex/worktrees/customer-experience/2026-10-agent-native-whatsapp-bot/02-Build/shopbot-ai/apps/server/src/services/demo-catalog.ts:5), [Catalog readiness flag](/home/gk-pc/.codex/worktrees/customer-experience/2026-10-agent-native-whatsapp-bot/02-Build/shopbot-ai/resources/catalog/ksmc-demo/catalog.json:5).
Improve: merchant-approved SKUs, own photos, Tamil aliases, separate replacement part versus whole tool, unit/pack/length conversion, verified price/tax policy, timestamped availability and a real import/sync workflow. Mark estimates clearly.

### P1: The project does not yet measure or control all-in customer cost
Status parsing discards Meta pricing fields; usage dashboard summarizes provider estimates, not WhatsApp costs, conservative holds or customer journeys. The cost-aware message planner is tested but is not wired into the live sender. Paid budget is per shop, without customer/day/hour limits or a paid project-wide guard.
Code: [Status schema](/home/gk-pc/.codex/worktrees/customer-experience/2026-10-agent-native-whatsapp-bot/02-Build/shopbot-ai/apps/server/src/services/whatsapp-channel.ts:20), [Usage](/home/gk-pc/.codex/worktrees/customer-experience/2026-10-agent-native-whatsapp-bot/02-Build/shopbot-ai/apps/server/src/http/owner.ts:62), [Paid reservation](/home/gk-pc/.codex/worktrees/customer-experience/2026-10-agent-native-whatsapp-bot/02-Build/shopbot-ai/apps/server/src/services/inference-budget.ts:63).
Improve: persist pricing category/billable/rate/version/currency, reconcile analytics/invoices, instrument journey costs and owner minutes, add bounded per-customer and per-period limits plus fair queues. Exhausted budgets must still offer cheap catalog controls and handoff.

### P2: Conservative reservation can shut off useful service; rate expiry is approaching
Each normal paid call reserves $0.324813 against the configured model maximum context, despite small observed calls. Unknown outcomes retain the reservation appropriately, but there is no operator reconciliation workflow. Evaluation holds already consume about 83% of its cap. Configured rate verification expires 1 November 2026, which disables live interpretation unless deliberately renewed.
Code: [Rate and token bounds](/home/gk-pc/.codex/worktrees/customer-experience/2026-10-agent-native-whatsapp-bot/02-Build/shopbot-ai/apps/server/src/services/inference-budget.ts:8), [Reservation](/home/gk-pc/.codex/worktrees/customer-experience/2026-10-agent-native-whatsapp-bot/02-Build/shopbot-ai/apps/server/src/services/inference-budget.ts:21).
Improve: enforce a smaller verified input bound that includes system/media tokens, preserve fail-closed accounting, add expiry alerts and evidence-based reconciliation. Never treat a timeout as automatically unbilled or blindly release holds.

### P2: Spoken self-correction and uncertainty need explicit representation
A real recording mentioned two PVC quantities that could represent a correction or different requirements. Identical matched lines can be merged by adding quantities. The current agent/backend contract does not clearly distinguish correction, separate line or uncertain amount.
Code: [Voice interpretation](/home/gk-pc/.codex/worktrees/customer-experience/2026-10-agent-native-whatsapp-bot/02-Build/shopbot-ai/apps/server/src/adapters/google-interpreter.ts:33), [Same-product merge](/home/gk-pc/.codex/worktrees/customer-experience/2026-10-agent-native-whatsapp-bot/02-Build/shopbot-ai/apps/server/src/services/tools.ts:145).
Improve: item-level evidence and uncertainty, correction markers, missing quantity as null, and one useful Tamil choice such as 4 total versus two separate quantities. Do not turn the model's confidence into purchase consent.

### P2: Long lists and missing first items can trap the sequential flow
Backend permits up to 20 lines but final interactive review rejects text longer than 1,024 characters; asking customers to remove items to fit is a poor completion path. An unavailable first category prevents later available items progressing until the customer clarifies/removes/hands off.
Code: [Full review length guard](/home/gk-pc/.codex/worktrees/customer-experience/2026-10-agent-native-whatsapp-bot/02-Build/shopbot-ai/apps/server/src/services/whatsapp-reply.ts:47), [Active-item selection](/home/gk-pc/.codex/worktrees/customer-experience/2026-10-agent-native-whatsapp-bot/02-Build/shopbot-ai/apps/server/src/services/product-verification.ts:19).
Improve: snapshot-bound paginated review or optional supported Flow/document, with final consent after all items are visible. Keep unavailable requests in a separate pending-shop-check section while progressing verified available lines. Never silently delete needs or fill with unrelated stock.

### P2: One slow media job affects everyone; retained media can fill the 1 GB VPS
Worker processing is globally serial across reconcile, media/inference and send. Media decoding/model delays block cheap text replies and owner replies. Database retains private attachment bytes without automatic expiry. Current free disk is about 1.25 GiB; 1,000 maximum-size photos could exceed it before indexes/WAL/backups.
Code: [Worker](/home/gk-pc/.codex/worktrees/customer-experience/2026-10-agent-native-whatsapp-bot/02-Build/shopbot-ai/apps/server/src/jobs/whatsapp.ts:5), [Retention maintenance](/home/gk-pc/.codex/worktrees/customer-experience/2026-10-agent-native-whatsapp-bot/02-Build/shopbot-ai/apps/server/src/db/maintenance.ts:7).
Improve: separate bounded media, interpretation and send work, preserve per-conversation order, prioritize safe owner/delivery work, and measure queue time. Define consented media retention/deletion, backup rotation and restoration drills. Do not raise concurrency without 1 GB memory measurements.

## 3. Recommended Customer Experience

1. Customer sends Tamil/Tanglish text, voice or photo. Recognize the actual request independently of inventory; preserve all requested lines and uncertain amounts.
2. Show a short Tamil heard-list summary when ambiguity matters, then focus on the first unresolved category.
3. Ask one useful catalog-grounded question above up to four real, photographed options. Exact best candidate first; alternatives must match the job/specification, not merely be in stock.
4. One product tap confirms that product only. Ask only missing brand/variant/size/quantity/unit information; preserve values already known.
5. Advance to the next requested category automatically. Keep a small progress indicator and list/edit/handoff actions.
6. Maintain unavailable items as pending shop checks rather than forcing deletion or presenting substitutes as exact matches.
7. Show an itemized estimated bill: quantity, catalog unit, unit price, line amount and total, with edit/remove controls and separate final submission consent.
8. Notify the owner and customer of the real acceptance outcome. Fulfillment, payment and stock reservation remain separate verified states.

AI should handle understanding, uncertainty and useful questions. Deterministic tools should control catalog lookup, arithmetic, units, prices, consent, list progression and submission. This is agent-driven understanding with reliable commerce behavior, not an unbounded model loop. No TTS or local speech model is needed.

## 4. Public WhatsApp Status

The saved Meta dashboard screenshot from 5 October shows KSMC RETAIL successfully Published. Evidence: 03-Output/022-meta-published.png and 022-whatsapp-connection-progress.md. The current dashboard label was not freshly inspected.

Today's API confirms +1 555-185-5021 is named Test Number in Test WhatsApp Business Account; it is CONNECTED with account_mode LIVE and code_verification_status NOT_VERIFIED. The LIVE account field is not proof of app publication or a production merchant number.

The backend still allows exactly one test recipient. It rejects unapproved inbound messages and outbound recipients, and configuration requires 1-5 test recipients. Removing the environment list alone is not a public-launch solution.
Code: [Recipient configuration](/home/gk-pc/.codex/worktrees/customer-experience/2026-10-agent-native-whatsapp-bot/02-Build/shopbot-ai/apps/server/src/services/whatsapp-config.ts:14), [Ingress gate](/home/gk-pc/.codex/worktrees/customer-experience/2026-10-agent-native-whatsapp-bot/02-Build/shopbot-ai/apps/server/src/services/whatsapp-channel.ts:73).

Conclusion: the app was published, but this bot is not currently open to everybody.

Public launch requires an actual merchant-owned verified/registered WhatsApp Business number or supported coexistence onboarding, correct subscriptions/permissions/token, explicit production audience mode with abuse/cost guards, verified merchant inventory, and testing from a fresh non-allowlisted number. Preserve old test conversation identity/history separately. For multiple merchants, review onboarding/permissions and tenant-specific channel, catalog, owner access, language and budget isolation.
Source: [Meta business phone numbers](https://developers.facebook.com/documentation/business-messaging/whatsapp/business-phone-numbers/phone-numbers.md).

No public-access rollout, number registration, OTP request or new customer messages were performed in this review.

## 5. Implementation Order And Acceptance Gates

### First: Measurement and service reliability
Add stage timing, journey IDs, cost categories, pricing webhook persistence, per-customer limits, rejection recovery and owner alerts. Test rejected versus unknown outcomes separately, preserve consent/idempotency, and prove an owner decision reaches the customer.

### Next: Merchant truth and Tamil understanding
Approve inventory/units/photos/store facts. Add spoken corrections, fractions, noise, technician terms and complete-tool/part cases to a human-labelled evaluation. Test Tamil-native and Tanglish input separately; English remains optional. Track top-four recall, wrong product/quantity, unresolved needs, clarification turns, handoff and completion, not only JSON validity.

### Then: Operating readiness
Introduce bounded fair workers, retention policy, backup/restore checks, rate-card expiry alerts and all-in dashboard. Run controlled concurrent-load tests on the actual 1 GB instance without live-message spam.

### Finally: Real-number controlled beta
Explicitly authorize production audience rollout after costs and catalog are verified. Use a small consented external customer cohort. Report cost per journey and accepted order, owner minutes, abandonment, delivery failures and queue latency. Broaden access only after the service loop works end to end.

Suggested predeclared beta gates: no unauthorized submission or wrong billing units in critical fixtures; every definitive send failure surfaces or recovers; unknown sends are not duplicated; current rate/budget limits stay enforced; merchant approves catalog truth; every requested item is retained; p95 stage/queue targets are set and measured under expected traffic. Accuracy claims need a representative labelled sample, not these small historical smoke tests.

## 6. What To Keep

Bounded SQL retrieval, independent multimodal recognition, actual catalog photos, Tamil-first preference, deterministic list/quantity controls, strict tool validation, idempotent inbox/outbox, stale-choice protection, immutable submitted requests, owner takeover controls, audited cost reservations and the regression suite are good foundations.

Main recommendation: prioritize reliable delivery, merchant truth, ambiguity handling and the measured service loop. Make the recommendation stage conditional on demonstrated value, and keep ordinary taps AI-free.
