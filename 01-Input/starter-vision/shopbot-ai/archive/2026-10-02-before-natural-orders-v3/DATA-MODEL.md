# Staged data model

PostgreSQL and Drizzle migrations. Add tables/columns as a feature ships; the earlier long entity list is not a prerequisite to a working bot.

## A. First text workflow

| Record group | Minimum purpose |
| --- | --- |
| stores/settings | Store profile, schema/templates, catalog version, spend policy |
| connections/identities | Trusted channel routing and store/actor identity |
| conversations/messages | Inbound/outbound text, pending choices, selected SKU, state version |
| products | Tenant-scoped SKU, family, specifications, unit/precision, current approved price/stock, source timestamp, version |
| carts/lines | Exact SKU, decimal quantity, price/source version |
| requests/lines | Immutable submitted snapshot and acceptance/fulfillment state |
| event/outgoing intents | Deduplication, durable dispatch and delivery state |
| provider attempts/usage | Actual/estimated/unknown usage, rates/policy version and budget state |

Rates can begin as versioned configuration with a snapshot recorded on each usage record. Budget reservation can begin as atomic store-period fields plus request records, rather than a wallet system.

Price/stock history can initially be audit/source change events and order snapshots. Split separate price/stock snapshot tables when reporting or reconciliation needs them.

## B. Media and owner access

Add assets/attachments/analyses, product drafts or typed draft proposals, change proposals, audit records, owner membership and authentication-library schema.

Binary media stays in volume/object storage. Records include tenant, purpose, storage key, hash, MIME, duration/dimensions, source/analysis version and expiry. Preserve observations independently of context-specific intent.

A single proposal representation may cover draft/publish/edit if its typed states remain clear; do not duplicate the same change in two parallel systems.

## C. Payments and store billing

Add immutable approved quote versions, merchant connection secret references, payment attempts/events, and platform invoices/lines.

Do not mix merchant product payment accounts with platform usage accounts. Optional detailed agent/tool logs, analytics tables and billing collection modules come from measured support/reporting needs.

## Constraints required in every stage

- Trusted tenant/actor context; tenant-scoped lookups and composite references.
- Before real multi-store hosting, database access policies and isolation tests under non-superuser roles.
- Unique SKU/event/proposal/submission/payment operation keys in their scope.
- Transactions for related state writes; optimistic concurrency for carts/proposals.
- No model-selected identity or arbitrary database query tools.
- Integer paise for INR money; explicit currency; validated decimal quantities.
- High-precision provider costs until invoice rounding.
- Unknown stock/usage remains explicitly unknown.
- No assumption of exactly-once external provider effects from internal unique keys.

## Mutation authority

Customer media -> attachment/analysis.
Owner media -> draft/proposal.
Confirmed owner action -> versioned record + audit.
Reviewed import -> source reconciliation, preserving approved enrichment.
Verified gateway event -> payment state.
Model interpretation -> proposed action/evidence, not an authoritative inventory/payment write.
