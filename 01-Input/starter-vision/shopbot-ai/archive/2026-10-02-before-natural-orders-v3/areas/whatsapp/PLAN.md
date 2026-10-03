# WhatsApp adapter and durable jobs

Build simulator first, then supported channel adapter. Verify signatures/raw bytes, route configured number to store, persist ingress/work intent, acknowledge promptly, and process with pg-boss consumers in the app.

Deduplicate logical effects and outgoing intents; track sent/delivered/billable counters separately. Reconcile uncertain external delivery after timeouts.

Current provider rules/schema/rates are verified at integration. Media/customer state persists while provider work runs asynchronously.

A separate worker deployment is a measured expansion option, not a startup requirement.
