# Evidence for the 14 October 2026 review

This folder records offline verification of commit `2403f76e0c770b9217fc191d2dc88ff8581560d3`, exported from the local Git object database. It does not establish current VPS, phone, or merchant catalog readiness.

- [verification.json](verification.json): source hashes, environment, scope, and check results.
- [reviewed-build.log](reviewed-build.log): successful TypeScript and client/server production build.
- [integration.log](integration.log): all 445 PostgreSQL integration tests passed, zero failed/skipped; disposable PostgreSQL 17.6 instance, subsequently removed.
- [probes.json](probes.json): actual derived product review, including the premature finish-order button when count is null, false choice status, missing measure display, and invalid playbook replacements. The probe asserts the existing failures; it does not demonstrate a repair.

Four Python catalog cleanup tests also passed after the original `01-Input/ksmc-demo/source` fixtures were included in the temporary export. No live Gemini call, WhatsApp send, production write, or application-source change was made.

The source API calls exercised by the direct probes were `makeProductCheck`, `visualProductReview`, `cartProgress`, `lineName`, `turnUnderstandingSchema.safeParse`, `validateRateCard`, and `worstCaseReservation`. Inputs were synthetic: one H15 paint line with null quantity and one unresolved PVC line with a one-inch structured measure. The JSON includes the rendered card actions, rather than only the reply text.

See the [reconciled implementation plan](../030-shopbot-reviewed-implementation-plan.md) for the analysis and staged fixes.
