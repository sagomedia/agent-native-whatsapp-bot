# Current status

Updated: 2026-10-01.

Stage: planning complete enough to begin a local trial implementation; no application has been built and no store matching results exist yet.

## Ready

- Project folder and Codex instructions.
- Confirmed 50-product trial, staff-confirmed ordering, and MCP plus dashboard owner access.
- Catalog preparation workflow, bounded search design, queued work, and trial evaluation plan.
- Earlier business transcript retained as background. Latest decisions take precedence over its older assumptions.

## Not supplied or verified

- Actual trial product list, SKU records, prices, units, stock, and shop photographs.
- A sample export and the exact billing-software name/version. Export availability is reported, not independently tested.
- Existing application code, deployment runtime, database, and image-storage arrangement.
- WhatsApp account/provider, credentials, and applicable current delivery rates.
- AI API credentials, chosen model, and model performance on real hardware examples.
- Owner MCP host and authentication method; required customer languages; fulfillment details.

## Next actions

1. Start task 001: define the trial data contract and review any supplied sample. If none exists, prepare clearly labeled synthetic fixtures and a merchant data checklist.
2. Implement the importer, catalog, and text search before adding provider-dependent photo/voice adapters.
3. Add the shared cart/order service, owner interfaces, and channel adapter.
4. Replace fixtures with 50 approved store SKUs and real photos; run the trial evaluation.

Missing data or credentials block real-world verification, not every local task. Keep the distinction visible in handoffs.
