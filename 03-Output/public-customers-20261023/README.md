# Public customer admission and bounded owner handover

The owner authorized opening the registered shop number to all customers while avoiding repeat AI charges and retaining genuine leads. This release adds explicit public admission, persistent repetition/burst controls and owner handover. It uses the exact deployed `preview-1d796298ef7a` source baseline, commit `96891b6507f6d578828b50b743293082ca3b43aa`; every source hash matched the VPS manifest before editing. The historical SMB working tree was left untouched because it contains older unfinished edits.

Public access applies consistently to inbound receipt, typing, provider status, assistant sends, owner replies and order notifications. The protected owner dashboard reports public access rather than the old test-only label. Thresholds, voice behavior, classification limits and operating instructions are in `02-Build/shopbot-ai/PUBLIC-CUSTOMERS.md`. Public policy rendering describes the enabled AI/media/order service and retained owner review; test mode remains available.

Validation: all 914 cases in the final full PostgreSQL integration run passed; all 11 final focused admission cases passed; all four catalog cleanup checks passed; production build/typecheck passed. The focused suite uses only synthetic customers and mocked AI/Meta transports. It covers new numbers, state-bound repeat suppression, 50-message bursts, another customer remaining independent, first-message voice, repeated valid/silent recordings, in-flight cancellation, shopping clarifications and owner reply/resume. The v26-to-current additive migration rehearsal passed and preserves old orders, pricing snapshots, delivery statuses and unknown budget holds.

No paid evaluation, live synthetic customer, marketing send, budget increase, order reset or replay of retained customer messages was used. The integration database was an isolated UTF-8 PostgreSQL instance extracted under `/tmp`, not the merchant VPS database.

Deployment is recorded separately in `DEPLOYMENT.json` after the verified immutable release is activated and its non-secret runtime checks pass. The environment and database are privately backed up through the existing native upgrade workflow. Retained pilot recipients make a test-mode rollback available. Schema 46 is additive; restoring application code must not restore an old database over new customer traffic.

A real message from a second, previously unlisted customer phone remains the device-level acceptance check after activation. Do not interpret synthetic test results as real phone delivery evidence.
