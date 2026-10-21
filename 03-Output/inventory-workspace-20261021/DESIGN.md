# Reference-led inventory workspace

## Findings from official documentation

Zoho's item overview combines primary details and stock facts; it distinguishes physical on-hand, committed and available quantities. Its editing guide uses an Edit → change fields → Save path. ShopBot can apply the same separation between values and operations: visible stock facts, a clear adjustment action and retained history.

Odoo's documented form architecture provides column groups, responsive sheets, tabbed pages and contextual action containers. Its product documentation exposes inventory-related actions according to the record's configuration. ShopBot can use grouped fields and contextual actions without copying unsupported warehouse, accounting or forecasting features.

Odoo documents search/filter/group/favorite behavior separately. ShopBot has real search, filtering, sorting and bounded pagination; these remain the table controls. Grouping and saved searches will not be shown until implemented.

Sources are linked in SCOPE.md. These are observations from the public user/developer documentation, not access to either product's internal design system or a claim of usability testing their applications.

## Chosen solution

A table-first inventory workspace with a compact product record. A spreadsheet alone would hide photo identity and selling-policy detail; the record therefore keeps those tasks alongside the inventory table rather than forcing everything into editable cells.

```
Products      Search…   Filters       New   Bulk facts   Import   Drafts
Product / code       Price/unit    On hand    Reserved    Available    Status    Actions

Product list | Product name · SKU · visibility                  More actions
             | Price/unit      On hand      Reserved      Available
             | General | Selling details | Stock | Photos | Customer search
             | Grouped labeled fields appropriate to the selected section
             |                                Cancel  Save draft  Review & publish
```

Core values remain visible above the tabs. The default General section shows identity, price/status, unit/increment, size, brand and type. Selling details contains pack/loose behavior and specifications. Stock keeps actual movement operations and history. Photos retains exact/reference evidence, uploads and publication choices. Customer search retains names, aliases, search terms and the real saved-catalog diagnostic.

Publication is one explicit review of actual values followed by Confirm & publish. There are no five verification checkboxes or duplicate photo checkbox. Missing/invalid facts identify the field and section; unknown price/stock stay unknown. Saving a draft does not publish or certify facts. The publication request still supplies the existing server-required confirmations only after the owner confirms that review.

## Visual system

- Existing ShopBot colors: white #ffffff, background #f2f6f3, ink #20382e, muted #52675d, teal #19685f, warning #8b520d. Color represents selection, state or an exception.
- Arial and the bundled Tamil font. Product title 20px, section title 15px, normal field text 14px desktop / 16px phone, supporting metadata 12px.
- Desktop grouped form fields and 36–40px controls; phone targets at least 44px. Dense rows show values with consistent alignment and tabular numerals.
- Left-aligned content. Borders divide records and field groups; avoid a separate large card for every quantity or instruction.
- Record tabs remain mounted to retain edits; keyboard navigation, visible focus, phone section selector, readable error recovery and draft guards are required.

## Structural review against the request

The previous screen spent space on repeated headings, summary cards, stock forms and a long confirmation area before showing all editable facts. This solution gives inventory facts a stable place, uses sectioned records for secondary work and replaces repeated acknowledgment with an explicit save/publication action. It preserves information density through grouping and alignment rather than shrinking every label or hiding required facts.
