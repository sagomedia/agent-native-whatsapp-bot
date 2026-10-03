# Catalog service and retrieval

Implement the service before importing a merchant's full data.

Use stable tenant-scoped SKU/source keys, family/specifications, selling units, decimal quantity precision, source price/stock records, versions, and approved asset mappings.

Start with exact identifiers, structured specifications, approved aliases, and PostgreSQL full-text/trigram-style retrieval as supported by the chosen schema. Return at most the configured candidate count. Add embeddings only after an evaluation shows a missing capability.

Catalog changes invalidate relevant cached searches. Owner drafts/proposals, confirmed changes, and staged imports all call the same domain service.

Keep descriptions/aliases/images separate from billing-source price/stock. A partial import omission does not delete a product. Manual source overrides need provenance and a reconciliation rule.

Client photography/enrichment is onboarding work after the engine exists. Synthetic fixtures let schema/search/cart development start immediately.
