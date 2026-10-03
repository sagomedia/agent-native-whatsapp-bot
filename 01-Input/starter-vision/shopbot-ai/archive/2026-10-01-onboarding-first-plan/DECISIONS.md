# Decision log

Prepared 2026-10-01. Confirmed means stated by the user; proposed means a starting recommendation that may change during implementation.

## Confirmed

| ID | Decision | Reason / evidence |
| --- | --- | --- |
| D001 | Start with 50 demo products | User says the merchant wants a trial with 50 products. |
| D002 | Staff confirm orders | User selected the staff-confirmation flow. |
| D003 | Provide MCP plus a dashboard | User explicitly requested both. |
| D004 | Plan for an export-based catalog | User reports that the billing software is exportable; no export has been obtained. |
| D005 | Include photo search and voice input | These are part of the promised customer experience. Exact photo-based variant identification is not guaranteed. |
| D006 | Keep AI preparation separate from customer runtime | User proposed photographing items and using AI IDE agents to classify and find reference images before indexing. |
| D007 | Preserve quoted commercial structure | ₹10,000 setup, ₹1,000/month, AI charges additional. Other charge treatment remains open. |

## Proposed defaults

| ID | Proposal | Reason |
| --- | --- | --- |
| P001 | One modular backend, relational database, shared domain services | Keep the 50-product trial maintainable and avoid duplicated rules across interfaces. |
| P002 | Manual reviewed import for the trial | Validate the actual export before attempting live billing sync. |
| P003 | Start with structured/text retrieval; add vision and optional stored image embeddings | Measure whether richer retrieval improves real hardware examples enough to justify complexity and cost. |
| P004 | Display stock freshness and ask staff to verify before confirmation | Offline store sales may make an imported snapshot stale. |
| P005 | English and Tamil as initial language candidates | The store context suggests these may help; the merchant's actual requirements are not confirmed. |
| P006 | A short real-store evaluation before full onboarding | Measure matching quality, onboarding effort, support, and usage rather than extrapolating from a polished mock. |

## Open decisions

- Exact billing-software identity, export schema, stable SKU keys, and stock update cadence.
- Existing server capabilities and implementation stack. No framework or model is selected yet.
- Actual 50 SKUs and the approved image source for each.
- AI API/provider, image retrieval method, owner MCP host, and authentication details.
- Required languages and local product names; pickup/delivery arrangements; customer details needed for a request.
- Current WhatsApp provider/rates, handling of AI and delivery charges, quotas, overages, and support limits.
- Trial budget and commercial success threshold. Evaluation quality targets in the trial plan are proposed targets, not a merchant promise.

When a decision changes, record the date, reason, and affected work. Do not rewrite an unverified assumption as a confirmed fact.
