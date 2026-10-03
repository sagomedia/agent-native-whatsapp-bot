# First real-store trial — after engine readiness

The engine is built and tested with fixtures first. This is client onboarding and real-world evaluation, not a prerequisite to implement the runtime.

## Sequence

1. Obtain 50 approved sellable SKUs via partial export or merchant-approved records.
2. Select similar variants as well as easy/branded/difficult items.
3. Import through the existing catalog service and record source price/stock timestamps.
4. Upload original shop/packaging photos; review any AI-proposed reference mappings through owner tools.
5. Configure hardware specification questions, aliases, languages, fulfillment settings, and real connections.
6. Test held-out text/photo/voice requests and staff-approved quotes.
7. If merchant payment test access is enabled, exercise hosted links and verified events in test mode before live use.
8. Measure actual usage, high-cost conversations, staff corrections, support, setup effort, and merchant value.

## Proposed evaluation set

At least 60 cases: 15 text/specification requests, 20 new photos of identifiable catalog items, 10 absent/unclear-item cases, 10 real voice notes, and 5 end-to-end requests. Add separate engine permission/payment/retry tests from engine-evaluation-plan.md.

Proposed target: at least 90% appropriate handling, reporting correct retrieval, needed clarification, and justified handoff separately. Zero invented inventory facts, silent ambiguous cart choices, unauthorized edits, or false paid/confirmed states in the test set.

These are initial evaluation targets, not claimed accuracy. Indexed reference images are not sufficient held-out customer photo tests.

## Commercial evidence

Record onboarding hours, runtime provider cost, delivery charges, gateway fees, support time, requests, staff confirmations, and verified completed sales. The recorded ₹10,000 + ₹1,000/month + additional AI structure needs this evidence before claiming repeatability or profitability.

Expand catalog coverage after fixing critical failures and measuring onboarding effort. A 50-SKU trial does not establish universal recognition across 4,000 variants.
