# Reusable agent tool core — verification

Verified 2 October 2026. Authoritative source: 02-Build/shopbot-ai. Input archives remain unchanged. This phase implements reusable backend tools and a local mock runtime; real AI and WhatsApp are not connected.

## Delivered

Six shared customer tools: search_products, get_draft, apply_draft_changes, preview_order, submit_order_request and get_order_status. Strict contracts, trusted scope checks, persistent unresolved lines, atomic compound edits, current-fact reviews, trusted confirmation, immutable shop-pending requests, version/idempotency guards and durable bounded mock-attempt recovery are implemented.

The simulator uses these services through a thin mock channel adapter. Core services contain no fixture store/conversation IDs or hardware families. A separate grocery fixture exercises the same tools, including fractional quantities and half-up paise rounding. The cleaned KSMC catalog remains optional onboarding data.

## Build and automated verification

Final source built directly from the SMB workspace with `docker compose up -d --build --wait`. TypeScript checks and server/dashboard production builds passed. Both app and PostgreSQL containers were healthy; ports remain bound to localhost:3017 and localhost:5437.

Final `docker compose run --rm app npm run test:integration`: 10 passed, 0 failed, 0 skipped. Tests use temporary random schemas and remove only their own fixtures.

Covered scenarios:

1. Five-item text, complete ₹914 review, one explicit confirmation, duplicate delivery and zero interpretation calls for known confirmation.
2. Four clear lines plus one ambiguous line; stale choice rejected, current ordinal resolves only that line and preserves all IDs.
3. Read-only price inquiry, uncertain quantity clarified with numeric “4”, unmatched item retained until removal.
4. Compound addition/change/removal/pickup; “yes, but…” edits; stale, unrelated and expired confirmation denied; queued yes cannot approve a later edited review.
5. Price/stock changes require fresh review; restored stock is recognized; submitted price snapshots remain immutable.
6. Second grocery store, fractional sugar quantity, scoped store/actor/role checks and denied foreign request reads.
7. Receipt replay, conflicting operation keys and atomic rollback for invalid dependencies or excessive lines.
8. Invalid, truncated and privilege-changing interpretation output cannot mutate state; live adapter construction fails closed.
9. Expired processing lease reuses persisted validated output once; exhausted attempts remain counted as unknown without extra invocation.
10. Original startup locking, durable inbox/drafts, duplicate/stale edits, mock-only HTTP and live seed/reset safeguards.

These tests do not certify real model quality, external provider execution exactly once, WhatsApp delivery, authenticated production access or production tenant isolation.

## Browser and real job queue

At http://localhost:3017, used the existing synthetic draft/history without resetting it. Submitted:

“change the tape to two and change the elbows to three and add one adjustable wrench and four M4 screws and one claw hammer”

The actual pg-boss worker produced five lines and a ₹914 review using one mock attempt. “yes, but make the elbows five” generated a new five-line ₹950 review with no submitted request. A separate “yes” submitted one request without another interpretation call.

Final synthetic state:

- Version 6; five draft lines; total 95000 paise.
- Request 3b4fa4ea-6b4c-482a-8738-2bd4a5fbe5b9.
- Acceptance awaiting_approval; payment not_requested; fulfillment awaiting_approval.
- Two persisted mock attempts; no pending inbox work.

Restarted the app with `docker compose restart app`. Compared the conversation, messages, requests and interpretation attempt count before/after: all unchanged. Ready endpoint returned ready/mock. Reloaded the browser and verified the same request/status. Original historical foundation replies remain visible in history as prior test records.

Screenshot: [003-agent-tool-core-simulator.jpg](003-agent-tool-core-simulator.jpg).

## Remaining scope

The English mock adapter is deliberately limited. Native SDK/model integration, dated rates, durable spend reservation and authorized live quality/cost evaluation are next. Mock attempts cost zero with null usage; paid billing is not implemented. No paid calls or customer messages occurred.

The unauthenticated local simulator permits one submitted request per conversation. New-order/amendment lifecycle, verified WhatsApp identity/delivery, owner authentication/MCP, staff approval/readiness, stock reservation and payment workflows are later phases. Search currently scans one store's active fixture catalog. KSMC brands, units, prices and tax treatment remain subject to merchant verification.
