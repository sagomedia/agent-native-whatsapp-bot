# ShopBot AI — reviewed engine scope

## Goal

Build a reusable retail bot that understands customer text/photos/voice, selects controlled business actions, stores durable state, supports owner administration, and accounts for usage and product payments.

The engine is built first. Client-specific specifications, language/templates, aliases, fulfillment, capabilities, and connections are configuration. Hardware is the first real profile; other retail profiles reuse the core. Service bookings require an explicit domain extension.

## User-confirmed requirements

- First real hardware-store trial: 50 sellable demo SKUs.
- Customer text, photo, and voice input.
- Staff confirmation of order requests.
- Owner MCP plus a dashboard.
- Export reportedly available; no actual export supplied.
- Store AI usage billing and customer product payments.
- Commercial quote: ₹10,000 setup + ₹1,000/month + additional AI charges.
- Inbound assistance; no marketing broadcasts in the initial scope.

## First implementation slice

One app plus PostgreSQL starts locally through Docker Compose, persists state, and offers a simulator with clearly synthetic products. In mock mode, initial migration and seed run automatically with safe locking. It requires no paid credentials.

The next slice adds the native Google provider adapter and a working interpreted-text-to-catalog flow, with metering from its first real call. Photo and voice follow before expanding owner/payment/onboarding modules.

## Required engine capabilities

- Trusted channel identity, durable ingress/jobs/outgoing intents, bounded retries.
- Shared typed services for catalog, clarification, cart, requests, quotes, owner changes.
- Controlled interpretation using the official Google SDK and validated structured intent; optional bounded native function calling.
- Media storage, analysis, and role-specific database effects.
- Persistent conversational state and deterministic actions/rendering.
- Owner drafts/confirmed changes, dashboard sessions, MCP authorization.
- Per-store configuration, usage limits/reporting/invoices, and payment adapter.
- Profile-based onboarding without copying the runtime.

## Completion evidence

Clean startup/reset/test commands work. State survives restart. Text/photo/voice flows behave correctly. Two fixture stores cannot access each other's data. Owner changes are versioned and audited. All live model calls are metered. Staff-approved payment links and verified payment events preserve separate states. Dashboard/MCP apply shared permissions. Mock and live/store results are reported separately.

No client export is needed to build these capabilities. Real data and credentials are needed for their actual compatibility/quality/merchant-value checks.

## Affordability

Reduce duplicated engineering, idle infrastructure, and unnecessary model calls. Measure quality, actual usage, high-cost cases, server capacity, delivery/gateway fees, setup, and support.

SDK simplification is a dependency/maintenance decision. At equal provider requests and tokens, it does not change the provider tariff. Actual cost gains require fewer/smaller calls without losing useful behavior.

Monthly quotas, markup/pass-through policy, retry billing, support scope, and provider-charge treatment remain open.
