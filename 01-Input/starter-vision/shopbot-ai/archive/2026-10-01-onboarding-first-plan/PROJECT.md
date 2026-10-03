# ShopBot AI

## Goal

Help a hardware-store customer identify the right stocked item, understand the recorded price and availability, and send a clear order request through WhatsApp. Reduce staff time spent on repeated product questions while preserving staff control over order acceptance.

First store: KSMC Grandson Hardwares. The reported full catalog contains roughly 2,000–4,000 product variants. Exact counts and the billing-software identity are not yet verified.

## Confirmed trial scope

- 50 demo products, counted as 50 sellable SKUs rather than 50 families containing unlimited variants.
- Customer input through text, photographs, and voice notes; replies may be text and approved product images. Voice output is not required.
- Photo-assisted search followed by clarification when exact specifications are uncertain.
- A cart maintained by the application, with quantity and variant selection.
- Order requests reviewed and confirmed by shop staff.
- Both an authenticated MCP interface and a small owner dashboard.
- Billing software can export data, according to the user. No export has been supplied yet.
- Inbound customer assistance is the focus. Marketing broadcasts are outside this trial.

## Customer journey

1. Customer describes an item, sends a photo or voice note, or follows a link containing a product identifier.
2. The system resolves explicit identifiers, transcribes voice if needed, and searches the approved catalog.
3. It asks one useful narrowing question when several candidates or variants remain.
4. It shows a small candidate set with approved photos, distinguishing specifications, and source-backed price/stock information.
5. Customer chooses an exact SKU and quantity. Application code validates the selection and calculates the cart.
6. Customer reviews the request summary and submits it once.
7. Staff review the request, verify current stock and price, and confirm or request changes. The customer receives the resulting status through the supported messaging flow.

If there is no useful match, the bot says so and offers staff assistance. If the exact variant cannot be determined, it does not silently choose one.

## Owner journey

The owner reviews imported data and suggested photo mappings, manages descriptions and aliases, reviews order requests, sees stock freshness, and checks usage through either MCP or the dashboard. Both surfaces apply the same validation and authorization.

## Out of the first release

Automatic payment collection; guaranteed exact identification from any photo; automatic stock reservation; marketing campaigns; live two-way billing integration; onboarding the entire store before testing; a general marketplace; and self-directed changes to live shop records.

These are scope boundaries for the trial, not permanent product restrictions.

## Commercial context

The user's quoted offer is ₹10,000 setup plus ₹1,000 per month, with AI charges additional. Server capacity is reported to be available at no charge to the user. Neither fact establishes profitability: preparation time, support, storage, delivery charges, taxes, and repeatability must be measured.

Earlier notes mention 3,000 responses per month. The counting unit, overage policy, and treatment of WhatsApp charges remain open. No quota or final margin is locked by this plan.

## Definition of done for the trial

1. Fifty approved SKU records and their available original/reference photos are loaded without fabricated inventory facts.
2. Text, photo, and voice requests reach the same product-selection and cart flow.
3. Similar variants are clarified; missing products and missing specifications do not produce invented exact matches.
4. Cart and order requests preserve SKU, quantity, unit, price version, and confirmation state. Duplicate delivery does not duplicate an order.
5. MCP and dashboard expose the agreed owner actions against the same database, with authentication and an audit trail.
6. Usage and cost estimates are traceable to recorded requests and a dated rate configuration.
7. The evaluation in `outputs/50-product-trial-plan.md` is run on real trial data; results and failures are recorded.

Actual live-channel completion depends on WhatsApp credentials and a supported messaging setup. Local simulation is useful progress but must be labeled as simulation.
