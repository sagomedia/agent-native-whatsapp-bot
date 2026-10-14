# Local counter-flow evidence — 14 October 2026

This evidence records the first implementation slice on `codex/reconciled-counter-flow`, based on reviewed commit `2403f76e0c770b9217fc191d2dc88ff8581560d3`. See [implementation scope and remaining work](../031-counter-flow-implementation.md).

- [verification.json](verification.json): check results, scope, prompt version and SHA-256 source/evidence manifest.
- [build.log](build.log): successful TypeScript, client and server production build.
- [integration.log](integration.log): all 458 tests passed, zero failed/cancelled/skipped; four concurrent test files, temporary schemas in disposable PostgreSQL 17.6.
- [journey.log](journey.log): eight customer-flow checks extracted from that final integration log. Original test numbers are preserved.
- [timing.log](timing.log): five timing/accounting checks extracted from the same final log, including simulated latency and unknown-charge holds.
- [catalog.log](catalog.log): all four Python catalog cleanup checks passed.

The [five-item transcript](../../02-Build/shopbot-ai/tests/fixtures/counter-five-item-transcript.json) retains wording, action bindings, bill rows and total. Its paint/scraper facts are synthetic and have no borrowed product photos. It is English renderer/contract evidence, not an actual phone delivery or acoustic recognition result.

The fake paid provider used by the accounting test has no network transport. No production database access, live model spending, customer message, hosted CI run or deployment was performed. The disposable test database was removed after verification. Current conservative budget/rate policies remain; full billing reconciliation and persistent deadlines across deferred claims are still planned.
