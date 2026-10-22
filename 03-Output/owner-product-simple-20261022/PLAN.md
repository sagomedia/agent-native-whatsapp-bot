# Owner product editor: everyday facts first

Accepted scope: the owner requested simplifying the pictured inventory editor, reducing learning and memory demands while keeping its functionality. This stage builds on the verified owner interface and 90-second voice implementation; it does not replace those unfinished integration branches.

## Findings and design

The current form duplicates price and identity information across its heading, four fact tiles, General and Selling tabs, and footer. Taxonomy, quantity increments, and price status appear as equally important everyday decisions. A long product rail leaves little room for product choices.

Retain the ShopBot teal (#196b63), white (#ffffff), ink (#20322e), muted text (#536b65), divider (#d1ded8), and selected background (#e6f2ed). Retain established accessible system/Tamil typography. Use whitespace and one reading column for the working form; avoid more cards, checklist gates, or a new wizard.

First view: product name/photo → price and unit together → clear unknown-price guidance → current shelf/held/available stock with a direct stock action. New products can enter opening stock. Optional brand/size/category sit under a descriptive disclosure; labels preview the current values. Keep specialist selling rules in Selling details, and customer terminology in Customer search. Keep all existing photo evidence and reference warnings, draft/publish validation, concurrency protection and stock movement semantics.

Remove duplicate totals from the product header. Show concise stock information near the stock action. Remove always-visible price status: entering an amount sets a checked price, clearing it keeps price unknown; zero requires an explicit free-item action. Move quantity increment into Selling details and ensure validation opens that section. Reuse saved facts, never infer merchant price/stock from approximate catalog prices. Keep source photos and uncertain selling basis visible when relevant. Product list should emphasize name, price and stock; source/code remain available in product details and photo section.

## Research

- https://www.zoho.com/inventory/help/items/items-overview.html — core item details and selling price/unit, optional advanced inventory and additional information.
- https://www.odoo.com/documentation/19.0/applications/inventory_and_mrp/inventory/product_management/configure/uom.html — units carry inventory/sales meaning; preserve explicit unit and conversions rather than hiding their effects. Official search excerpt available; direct fetch timed out.
- https://www.nngroup.com/articles/4-principles-reduce-cognitive-load/ — logical groups, clear labels, contextual help, reduce unrelated decisions.
- https://www.nngroup.com/articles/progressive-disclosure/ — secondary options on demand, essential tasks remain available.
- https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md — keyboard focus, inline validation, labels, responsive content, unsaved-change guards.

## Verification

Build and catalog preparation checks; focused product validation tests; synthetic local browser checks for routine price entry, blank/zero/free price, advanced identity preservation, quantity validation focus, unknown/held stock, photo evidence, drafts and publication, saved section routes, unsaved navigation, mobile/desktop English and Tamil. Record screenshots and exact outcomes. No paid inference or live customer sends.
