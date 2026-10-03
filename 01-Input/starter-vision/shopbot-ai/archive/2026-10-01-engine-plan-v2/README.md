# ShopBot AI — reusable bot engine

Replanned 2026-10-01 around implementation of the bot itself. This package contains architecture and implementation specifications; there is no runnable application yet.

## Start

1. Read PROJECT.md for scope.
2. Read ARCHITECTURE.md for the chosen stack and execution model.
3. Read RUNTIME-FLOWS.md, DATA-MODEL.md, and BILLING.md for media, database changes, and money flows.
4. Use IMPLEMENTATION.md and work/queued/ in dependency order.
5. Open this directory in Codex and paste outputs/codex-start-prompt.md.

The first deliverable is a local application that starts with Docker Compose, seeded demonstration stores, a conversation simulator, a dashboard, and mock AI/payment adapters. Real merchant data is not a prerequisite for building it.

## Organization

| Path | Purpose |
| --- | --- |
| AGENTS.md | Agent instructions and product invariants |
| PROJECT.md | Reusable engine goal and definition of done |
| STATUS.md | Actual progress and missing inputs |
| DECISIONS.md | User choices and technical recommendations |
| ARCHITECTURE.md | Stack, components, roles, agent loop, and efficiency |
| RUNTIME-FLOWS.md | Text, voice, image, owner changes, and payment sequences |
| DATA-MODEL.md | Entities, fields, identities, and transaction rules |
| BILLING.md | Store usage billing and customer payments |
| IMPLEMENTATION.md | Build milestones and executable acceptance criteria |
| inbox/ | Unreviewed client inputs |
| areas/ | Focused component plans |
| work/ | Queued, active, and completed tasks |
| resources/ | Sources and fixture guidance |
| outputs/ | Starting prompt and evaluation documents |
| archive/ | Inactive earlier plan |

Hardware is the first retail profile, with 50 products for its real-store trial. A second synthetic retail profile verifies reuse. New profiles change specifications, prompts, aliases, fulfillment settings, and feature flags; they do not require a separate bot codebase. Service bookings and other different transaction models require an extension module.

The earlier onboarding-first plan is archived. It is not the active specification.
