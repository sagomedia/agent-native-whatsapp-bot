# Working and customer-experience preferences

Recorded from the owner's explicit instructions on 26 October 2026.

## Development models

Use Sol 6.1 Medium for planning, coding, debugging and integration. Delegate predictable operations with clearly specified inputs and acceptance conditions to Terra 6.1 Medium. The owner may change the primary model; Terra remains the supporting model unless instructed otherwise. These are development-agent preferences; they do not change the shop's deployed inference provider.

## Shopping experience

ShopBot is a visual retail ordering experience for a catalog that may grow to 3,000 products. Product discovery must show real photos, catalog names, rupee prices and clear tap actions. Prefer a native carousel for two to ten relevant choices; use one image for one genuine choice. Do not invent products or photos to fill a carousel.

When too many products match, narrow by real category, use, brand or specification through visual cards. An example category photo illustrates the group and must be labelled as an example; selecting it narrows the search rather than adding that example product. Missing images use honest local instruction cards, never an unrelated product photograph.

Keep the full requested list and quantities while checking one product at a time. Show item progress and a visual list guide. Product selection and final order submission are separate actions. A missing quantity must remain missing; an existing count must not be asked again.

Tamil and Tanglish, product pictures and the existing welcome audio are central to the audience. Brief captions support the visuals. Do not turn ambiguous product discovery into a plain-text FAQ exchange.

Aim for fewer than fifteen customer turns for ordinary orders, without cutting off large orders or skipping consent. Category, brand, product and quantity taps should reuse current store-scoped state without extra inference calls. Generate instruction images locally and cache them; do not use paid image generation for routine UI cards. Measure actual message and inference usage rather than promising a fixed cost from test turn counts.
