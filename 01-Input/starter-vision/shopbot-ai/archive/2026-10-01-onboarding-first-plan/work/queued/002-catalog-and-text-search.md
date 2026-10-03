# 002 — Import, catalog review, and text search

Status: queued. Dependencies: 001.

## Work

Build staged import with preview/validation, approved image mappings, preserved enrichment, stable keys, and stock timestamps. Build structured/text search and explicit variant clarification. Use available fixtures until merchant data arrives.

## Completion evidence

- Repeated import does not create duplicates or erase enrichment.
- Partial-import omissions do not silently delete products.
- Text/specification requests return bounded candidates.
- Wrong or missing size/grade does not add an arbitrary variant.
- Prices/stock are read from source records, including unknown/stale cases.

An initial catalog-review page may be built here and reused by task 005.
