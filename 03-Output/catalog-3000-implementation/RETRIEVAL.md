# Catalog retrieval implementation

17 October 2026. This is a local implementation and synthetic SQL evaluation, not a release or live Tamil voice acceptance report.

The retrieval path keeps existing exact SKU → exact name → exact alias precedence and object/family safeguards. It now applies typed number/unit eligibility before the first 120-row candidate limit. A sequence of 4 kg distractors cannot consume the page for a 4 litre request. Supported measurement spellings, decimal values and ordinary fraction spellings compare without fuzzy numeric matching or inferred litre/kg, litre/ml or inch/mm conversions. Product aliases remain search evidence; physical dimensions come from current product names, structured specifications and pack contents. Explicit plan specification filters remain mandatory, including for exact identities.

Remaining identity checks run in batches of at most 120 SQL rows until 120 eligible candidates survive or the SQL scope is exhausted. At most 120 products are retained for ranking and at most ten are returned. This makes a late requested identity reachable when more than 120 earlier lexical matches fail the customer's object/identity constraints. Explicit preferred SKUs are brought into the candidate page only within the same SQL constraints; an exact catalog identity keeps first place. Duplicate exact names remain ambiguous. Store scoping and the existing pipe/hose/cutter and brush/bush protections remain in place. No embeddings, provider, guessed taxonomy merge or catalog publication was introduced.

Results include an optional backward compatible `diagnostics` object: canonical query, applied family/brand/specification/measurement constraints, SQL match count, scanned/rejected row counts, candidate-limit flag, identity tier and uncertainty codes. Ranking scores remain deterministic weights, not probabilities. Empty/unsupported results also include diagnostics. When a candidate limit applies, `totalCount` and facet counts describe the SQL match scope; they are not proof that every remaining row would pass the later identity checks. A complete scan reports the eligible total.

Facets aggregate the complete matched SQL scope. Each key has its own distinct-value count and page; the old global 120-facet-value cap no longer hides a rare brand or a later specification key. A response contains at most twelve facet keys, with a requested key prioritized; `facet_key_limit` exposes key truncation. `facetPage: {key, offset, search?}` supports bounded direct tool exploration. Customer buttons contain two choices plus “More choices” when more than three remain, or up to three final choices. The continuation event carries a reserved action token; `refinementPlan` derives the next offset from the current result, and the existing question ID/version checks reject replay. Choosing a real filter clears its pagination state. This is wired through discovery replies, product verification and the shopping options action. The simulator renders the action as a readable phrase.

`get_catalog_map` now accepts `search`, `departmentAfter` and `familyAfter`, alongside `departmentId`. Results retain the existing limits of twenty departments and thirty families per department, and expose continuation IDs. Department counts include all their families, including those outside the page. A selected department is required for family continuation. Search and continuation keep all category nodes reachable without increasing the initial model context.

## Verification

Run only against an explicitly isolated database:

```sh
DATABASE_URL='<isolated database URL>' node --import tsx --test tests/catalog-retrieval-scale.test.ts tests/catalog-discovery.test.ts tests/catalog-scale-identity.test.ts tests/retrieval-identity.test.ts
npm run typecheck
DATABASE_URL='<isolated database URL>' CATALOG_SCALE_EVAL_ISOLATED=1 node --import tsx scripts/evaluate-catalog-scale.ts --output /absolute/path/retrieval-evaluation.json
```

The evaluator requires both environment variables, creates a private random schema, and drops that schema after the run. It uses a versioned synthetic fixture: 13 original variants, 300 original variants, and those same 300 variants plus 2,700 misleading shared-alias/wrong-unit distractors. It tests every original exact name and SKU at each size and seven critical scenarios per size: pack spelling/model identity, wrong magnitude, wrong physical unit, explicit brand conflict, a rare late brand, an absent product, and duplicate-name ambiguity. Failure makes the process exit nonzero. It makes zero provider calls.

See `retrieval-evaluation.json` for counts and local timings. The focused tests additionally exercise 3,000 wrong-unit distractors, identity rejection beyond the original cap, all 180 brands across pages, independent specification facets, taxonomy overflow, preferred late SKUs, and a real runtime “More choices” action with stale replay rejection. Existing regression coverage includes a 10,000-product store, store isolation, adversarial semantic hints, Tamil aliases, object-type ambiguity and existing product/cart verification behavior.

## Limits and remaining acceptance

This replay does not establish held-out natural-language candidate recall, speech recognition accuracy, OCR completeness, source-family correctness, merchant acceptance, live WhatsApp latency, simultaneous-chat throughput, or production readiness. No supplied source categories were combined. The shortened Apex Ultima source-family issue remains dependent on reviewed canonical maps.

Eligibility batching bounds memory and returned context, not the total SQL work for every broad request: a scope with many rejected rows may require several ranked SQL pages. Measure such rejection-heavy requests and concurrent workload on the intended host. Facet counts cover the SQL scope and can include rows rejected by the final identity check. There is no automatic substitute or relaxed-constraint retry when evidence is insufficient. The provisional 500 ms search target is a local SQL-only comparison and needs host/load validation; no end-to-end timing claim follows from it.
