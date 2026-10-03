# Metering and operations

Primary specifications: BILLING.md and IMPLEMENTATION.md.

Implement budgets and provider usage capture before live model calls. Keep raw provider cost, merchant-billable amount, invoice lines, WhatsApp delivery charges, and product payments separate.

Persist actual/estimated/unknown usage status and dated rates. Invoice rounding occurs at documented aggregation boundaries. Reconcile ambiguous retries; policy decides whether internal failures are billable.

API/worker/PostgreSQL are the initial Compose services. Local media is shared persistent storage. Hosted operation needs HTTPS, backups, protected secrets, health checks, and measured concurrency.

Inspect costs and support by store, modality, and successful outcome. Free server capacity and IDE allowances are not evidence that every store has zero operating cost.
