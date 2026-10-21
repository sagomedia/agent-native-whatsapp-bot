# ShopBot orders and stock UX review

The owner requested research and alternative designs after reporting that the deployed redesign looked better but was harder to finish work in. This package is a proposal, with synthetic data and no live connections. It does not change the production application.

- Open [the review page](index.html) for three generated concepts and the recommendation.
- Open [the clickable prototype](prototype.html) to compare A (order sheet), B (guided review), and the shared Stock workflow.
- Read [the research and design brief](RESEARCH-AND-DESIGN-BRIEF.md) for source links, diagnosis, tradeoffs and implementation safeguards.
- [Image prompts](IMAGE-PROMPTS.json) record the built-in `image_gen` prompts, including the correction to concept B's sample price labels. Generated product illustrations remain concept imagery, not catalog assets.

The owner selected A, the order sheet, on 20 October 2026. The app must fit the browser window; order/item lists may scroll independently. The prototype keeps the order header, total and main action visible while content panels scroll. The exact supplied visual reference is saved as `images/approved-order-reference.png`. B is retained as an alternative concept.

## Run locally

From the repository root:

```sh
python3 -m http.server 5183 --bind 127.0.0.1 --directory 03-Output/order-inventory-ux-concepts-20261020
```

Then open <http://127.0.0.1:5183/>. Files also open directly; product images are relative assets. Prototype state lives only in the current browser tab's memory. Refreshing or Reset demo restores sample data. Save draft and send/approve/collect actions are simulations.

## Verification

`check-prototype.mjs` passed quote resolution and the ₹808 → ₹1,058 arithmetic, sequential price typing, explicit simulated customer approval, stock reservation/collection, receive/sale/count previews, held-stock guards, unknown stock, the guided alternative, five viewport sizes, and zero live API calls. Screenshots are in `evidence/`.

`check-viewport.mjs` passed at ten viewport sizes from 320 × 480 to 1536 × 1024, including short laptop and landscape windows. It stresses long orders, long order queues and long stock lists/tasks; verifies that the document does not scroll; checks that the order header, total and action remain stationary; and exercises the original request, product dialog and narrow-screen stock picker. Measurements are in `evidence/viewport-checks.json`; current screenshots start with `evidence/fitted-`.

These checks validate the demo's behavior. They do not establish usability with real shop staff, backend correctness, message delivery, saved drafts, recovery, concurrent editing or the full production order lifecycle. The research brief records requirements that a later implementation must preserve.
