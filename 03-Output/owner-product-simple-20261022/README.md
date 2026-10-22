# Simpler product entry

The first product panel now asks for three everyday fields: name, shop price and selling unit (previously eight inputs/selects). Shelf stock, held quantities and available quantities sit beside a direct Update stock action. Opening stock remains optional for new products. Unknown counts stay unknown.

Brand, dimensions and product category are available in one optional disclosure whose summary shows saved values. Quantity increments belong in Selling details, with plain wording and validation that opens and focuses the correct field. Pack, loose-sale and cut-length policies, photos and source provenance, local names, search diagnostics, taxonomy creation, CSV, bulk updates, clone/hide actions and draft/publication concurrency protections remain available. No acknowledgment checklist was added.

Entering a price sets a checked price; clearing it leaves the price to confirm. Zero is blocked from publication until explicitly marked free. Drafts leave the live catalog unchanged. Reference-photo warnings remain beside the main photo as well as source evidence. Product list entries emphasize recognizable identity, price and stock; Tamil names are prioritized for Tamil owners. Product codes remain in the record and optional details.

## Validation

- Production build/typecheck passed; catalog preparation 4/4.
- Full UTF-8 PostgreSQL integration suite: 859/859, zero failures/skips (299 seconds).
- Product review validation: 5/5, including navigation to the relocated quantity rule.
- Real synthetic owner services: eight layouts (1440, 800, 390 and 320px; English/Tamil), only three everyday controls, no horizontal overflow, advanced brand survives publication, draft preserves live price, price/zero/free/unknown transitions, existing stock holds preserved, new unknown stock preserved, unsaved-change protection, and quantity validation focus. No browser errors.
- Existing inner workflows: 11 scenarios, 16 layouts, zero browser errors; order/stock return, uncertain stock retry, proposal recovery and CSV reload/recovery retained.
- Content allocation: 18 cases including long Tamil, keyboard-height fallback, search reload, pagination, tools focus and return navigation. At 320×640 the product panel has 314px of usable space before its action bar. The broad original harness had two timing failures at its order-return scroll assertion, outside the changed product code. An instrumented rerun completed that assertion and the remaining checks; a separate isolated return check restored 84px exactly. No order code or test assertion was changed to conceal the intermittent result.

Evidence uses disposable synthetic data only. Inference and channel sending are disabled. Actual shop-owner acceptance is still required; these checks establish correctness and responsive behavior, not a measured reduction in human learning time.

See [PLAN.md](PLAN.md) for the accepted scope and official research. This stage is stacked on the 90-second audio branch to preserve the already deployed source. The UI is locally available on port 3044; VPS publication of this new UI is separate from the audio deployment.
