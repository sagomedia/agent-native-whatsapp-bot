# Current status

Updated 2026-10-02. Revision 4: natural multi-item ordering added.

## Completed planning and preview

The reviewed native-SDK/controller architecture is retained. NATURAL-ORDERS.md now specifies batch item interpretation, compound changes, contextual clarification, version-bound customer confirmation, staff picking/packing/readiness and store pickup location. Main architecture/runtime/schema/implementation/prompt and queued tasks include these requirements.

A separate customer-experience website exists with scripted text/photo/voice, cart, simulated staff acceptance and simulated payment. It is an illustration, not the production engine and not a validated natural shopping-list agent.

## Actual engine implementation

No production engine, compose setup, migrations, populated engine fixtures, provider adapter or real runtime results exist. Multi-item interpretation/fulfillment requirements need implementation and evaluation.

## Next action

Start work/queued/001-local-foundation.md with at least five distinct fixture products. Slice 002 implements the natural-order text flow described in NATURAL-ORDERS.md. Media, WhatsApp, staff/MCP and payments follow in the existing eight slices.

Client records are not required for mock engine work. Real-model/channel/payment/fulfillment compatibility, accuracy, costs, server capacity and profitability remain unmeasured.
