# Proposed data model

PostgreSQL is the authoritative application store. Binary media lives in a persistent volume/object store. Drizzle migrations define the schema; JSONB is used for bounded profile-specific specifications and analysis, not as a substitute for every business table.

## Core entities

| Entity | Main fields / invariants |
| --- | --- |
| tenants | id, name, profile, catalog_version, status |
| store_settings | tenant_id, languages, spec_schema, policies, feature_flags, budget settings, settings_version |
| channel_connections | tenant_id, provider, phone_number_id, secret_reference, status; external routing key unique |
| memberships | owner/user ID, tenant_id, role; joins authentication tables |
| customers | tenant_id, channel identity; unique per store/channel identity |
| conversations | tenant_id, customer/actor, channel, state_version, current state, pending clarification/proposal, timestamps |
| messages | tenant_id, conversation_id, direction, provider message ID, text/transcript references, timestamps |
| inbound_events | connection/tenant, provider event key, payload reference, verified/processed status; unique event key |
| media_assets | tenant_id, storage_key, hash, MIME, bytes, duration/dimensions, purpose, uploader, retention time |
| message_attachments | message_id, tenant_id, asset_id; tenant-consistent relationship |
| media_analyses | tenant/asset, task, model, analysis_version, transcript/evidence JSON, uncertainty, status; unique analysis key |
| products | tenant_id, SKU/source key, family, name, specifications, selling unit, quantity precision, source metadata, version |
| product_assets | tenant/product/asset, source URL, evidence type, approval, family-or-SKU mapping |
| stock_snapshots | tenant/product, quantity or explicit unknown, source, source timestamp |
| price_records | tenant/product, currency, amount_paise, source, effective time, version |
| product_drafts | tenant/actor, proposed fields, missing authoritative fields, asset links, draft state |
| change_proposals | tenant/actor, target, expected version, before/after, transcript reference, expiry, confirmation/application state |
| audit_events | tenant/actor, action, entity, before/after, request/proposal ID, time |
| carts / cart_lines | tenant/conversation, exact SKU, decimal quantity, unit, price version; validated arithmetic |
| order_requests / order_lines | tenant/customer, immutable submitted snapshot, acceptance state, fulfillment state, idempotency key |
| quotes | tenant/order, approved actor, immutable items/amount/currency, version, expiry |
| payment_connections | tenant, provider account/merchant reference, secret_reference, test/live state |
| payment_attempts | tenant/quote, provider link/payment ID, amount/currency, payment state, uncertain/reconciliation status |
| payment_events | tenant/connection, provider event ID, verified event/state; unique per connection/event |
| agent_runs / tool_runs | tenant, event/conversation, role, prompt/config versions, tool/result summaries, timings and outcomes |
| usage_events | tenant/run/attempt, provider/model, operation/modality, actual usage, rate ID, provider_cost, billable_amount, settlement state |
| rate_cards | provider/model/operation, currency, modality/unit rates, effective range, source URL, version |
| billing_accounts / budget_reservations | tenant, spend period, limit, reserved amount, reconciled spend, policy version |
| invoices / invoice_lines | tenant, billing period, fixed/usage/delivery lines, final amounts, rate/FX snapshots, state |
| outgoing_events | tenant, payload reference, destination/action, dedup key, status, retry/reconciliation fields |

Better Auth owns its required authentication/session tables; generate them using the selected compatible adapter, then apply project membership rules.

## Tenant and integrity rules

All tenant-owned lookups and composite relationships enforce tenant consistency. A product/asset/order ID from another tenant cannot be referenced simply because its UUID exists.

Enforce repository/service scoping and PostgreSQL row-level security for tenant business data using a non-superuser application role and trusted transaction-local tenant context. Worker jobs establish that context from verified stored events. Auth/platform administration and queue metadata need explicit separate access policies.

Use unique constraints for tenant + SKU, provider connection + event ID, analysis cache key, order submission key, proposal application key, and quote/payment-link operation key.

An application idempotency key alone does not guarantee exactly-once provider requests; persist attempted external calls and reconcile uncertain outcomes.

## Numeric rules

Prices and payment amounts use integer paise for INR. Quantities use validated decimal values with product-specific precision. Currency is explicit.

Provider costs use high-precision decimal values and original currency; preserve usage, rates, and FX snapshots. Round at documented invoice boundaries rather than turning each tiny usage event into a whole paise.

Model-reported certainty is metadata, not a calibrated accuracy value or database authority.

## Mutation rules

Customer uploads -> message attachment/analysis.
Owner uploads -> draft/proposal.
Approved owner change -> validated product/source override + version + audit.
Billing import -> reviewed source price/stock reconciliation preserving enrichment.
Verified payment event -> payment state + outgoing notification.
Model interpretation alone -> no authoritative price/stock/payment write.

Use optimistic concurrency for proposals and carts; transactions for related writes. Preserve import provenance and explicit manual override policy rather than silently choosing which source wins.
