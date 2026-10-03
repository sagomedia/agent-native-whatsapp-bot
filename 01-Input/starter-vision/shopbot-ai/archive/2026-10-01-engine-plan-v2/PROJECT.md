# ShopBot AI — engine first

## Goal

Build one reusable WhatsApp commerce bot engine that understands text, product photos, and voice notes; calls controlled business tools; stores durable conversation/cart/order state; supports owner changes through MCP and a dashboard; and accounts for AI usage and customer payments.

Merchant onboarding configures this engine. The initial business scope is retail product sales. Hardware is the first real-store profile; a second synthetic retail profile tests reuse. Different domains such as service bookings need explicit modules.

## User-confirmed choices

- First real-store trial: 50 demo products for KSMC Grandson Hardwares.
- Customer text, image, and voice input.
- Staff confirmation of order requests.
- Owner MCP plus dashboard.
- Billing software reportedly exports records; no export has been obtained.
- Both AI usage billing for stores and product payments for customers.
- Commercial quote: ₹10,000 setup, ₹1,000/month, AI charges additional.
- Inbound assistance; marketing broadcasts are not part of this release.

## First deliverable

A clean-machine local demo that starts through the documented Docker Compose command, with no paid credentials. It includes seeded stores, a conversation simulator, persistent state, a dashboard, mocked media/provider responses, visible usage records, owner change proposals, and simulated payment events.

Real text/vision/audio calls, live WhatsApp, and real payment collection are distinct integration stages. They do not block engine development.

## Reusable capabilities

1. Event ingestion, tenant routing, durable jobs, retries, and outgoing-message delivery.
2. Role-scoped agent definitions with typed tools and bounded execution.
3. Text, image, and voice normalization with saved media-analysis state.
4. Catalog retrieval, variant clarification, carts, and staff-approved quotes.
5. Owner drafts and confirmed changes with audit/version control.
6. Per-store settings, domain profiles, provider connections, and capabilities.
7. AI metering, spend limits, cost display, and monthly invoice records.
8. Hosted product payment links, verified payment events, and reconciliation.
9. Authenticated owner dashboard and MCP tools against shared services.

## Definition of done for the engine

- Documented local start/reset/test commands work from a clean checkout.
- Two seeded retail profiles run through the same runtime without tenant leakage.
- Conversation state and unfinished jobs survive restart.
- Customer text, image, and voice inputs reach the same business flow.
- Customer uploads stay separate from catalog writes; owner uploads create reviewable drafts.
- Owner voice edits cannot change an uncertain target or stale version silently.
- Every real provider call goes through a metered, budget-aware adapter.
- Cart arithmetic and order/quote transitions are deterministic server behavior.
- Payment links use staff-approved amounts; only verified provider state marks payment captured.
- MCP and dashboard apply the same authentication, authorization, and business rules.
- Mock evidence is distinguished from actual integration and real-store evidence.

## Commercial boundary

We aim to reduce per-store engineering by sharing the engine and changing profiles/configuration. Affordability must be established through measured infrastructure, media usage, WhatsApp delivery, payment fees, onboarding effort, and support. The quoted price is recorded; profitability is not claimed.

Detailed monthly quota, usage markup/pass-through policy, support allowance, message-charge treatment, deployment capacity, and merchant payment-account eligibility remain open.
