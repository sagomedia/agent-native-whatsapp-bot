# Catalog service

Implement current SKU/specifications/unit/price/stock/source/version records first; use fixtures before merchant import.

Shared services support search, cart facts, owner proposals, and staged imports. Preserve approved image/alias enrichment and explicit source override policy. Partial imports do not silently delete omitted products.

Start with structured matching and bounded PostgreSQL retrieval. Catalog changes invalidate relevant caches. Price/history detail can be split later when actual reconciliation/reporting needs it.

Real 50-SKU onboarding tests importer/photo quality after the engine exists.
