# Catalog and image preparation

## First data batch

Prepare 50 sellable SKUs, including visually similar variants. A full export is not required to begin the demonstration: a partial export or manually entered, merchant-approved trial records can be used. Keep synthetic demonstration records separate.

For each SKU, retain source identifier, display name, family/category, brand/model when known, distinguishing specifications, selling unit, allowed quantity precision, currency, approved price, stock or explicit unknown availability, and source update time. Empty fields remain unknown; AI does not fill inventory facts by guessing.

Use source keys consistently. Names alone are not stable identifiers. Clarify whether the billing export uses one item row per variant or a parent/variant structure.

## Original and reference photographs

1. Photograph the item and, when available, its packaging/model/size label.
2. Associate the photo with a known store SKU or family before enrichment.
3. Let an AI preparation agent suggest category, search aliases, visible text, and possible manufacturer/distributor reference images.
4. Verify the reference against the brand, model, specification, and original photo. Record source URL and permission/license basis for reuse. If suitability is unclear, use the shop photo.
5. Review and approve the mapping; retain both original and approved reference assets with provenance.
6. Index approved descriptions and any chosen image embeddings. Reprocess only changed records/assets.

IDE subscriptions can assist this preparation workflow. Their included allowances are not assumed to power the deployed customer service. Keep a record of preparation effort and any external API spend.

A family image can illustrate several variants if labeled that way. It cannot establish which size or grade the customer needs. Never generate a plausible substitute and use it as identification evidence.

## Import and reconciliation

Stage each import, show a preview of added/changed/rejected rows, validate units and identifiers, then apply it. Reimporting the same snapshot must not create duplicates.

Keep merchant-approved descriptions, aliases, and photo links separate from source-controlled price/stock fields. Later imports must not silently erase enrichment or ignore explicit owner overrides. Overrides, if supported, need a recorded origin, scope, and expiry/reconciliation rule.

An absent SKU in a partial export is not automatically a deleted product. Define deletion semantics after inspecting the real export.

## Output

Approved trial catalog, image manifest, import report, and a record of time spent per SKU. No live write-back to the billing system in this phase.
