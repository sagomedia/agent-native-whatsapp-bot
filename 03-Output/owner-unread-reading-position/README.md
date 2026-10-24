# Owner unread indicators and saved reading position

Issue: https://github.com/sagomedia/agent-native-whatsapp-bot/issues/77

Orders have a small red unread dot and navigation count, separate from the New/Ready/Completed workflow. Opening the actual order detail records the exact displayed attention snapshot; concurrent customer amendments remain unread. Default previews and hidden mobile panels do not mark an order read.

Chats show unread customer-message counts even after the bot replies. Read progress advances only through visible messages in an explicitly opened chat. A separate message anchor and pixel offset restore the reading position across navigation and reload. An unread divider, forward/backward history pagination and Latest messages control support long histories without skipping arrivals or moving the owner while reading earlier messages. Position changes persist on the server for the existing single configured owner per shop; failures display a retry notice.

## Source and data preservation

During validation, production was found at source `2a700242ad0cfb59c3ae5c3ff65bc560c6b90b66`, release `preview-6b3ef5daa8f3`. Its exact local checkpoint was merged before validation and packaging. Owner MCP workflows, inventory imports, photo recovery, diagnostics and migrations 47/48 remain intact. Migration 49 adds two owner attention tables and one inbound-message index. No product/order/message data is rewritten; customer receipts, reply controls and commerce stages retain their behavior. No extra customer content is logged.

## Verification

Synthetic browser rehearsal on a loopback-only disposable database:

- Desktop orders: two red unread dots; opening one cleared its dot and changed the navigation count from two to one while both orders remained New.
- Mobile: five unread customer messages remained unread while the detail panel was hidden. Opening the chat cleared only visible customer messages. Two subsequent customer messages produced a count of two even after a bot reply.
- Long history: a 360-message chat restored sequence 139 at offset -16 pixels after navigation and reload. A subsequent arrival retained that exact viewport anchor; Latest messages reached the new arrival.
- No WhatsApp, AI or payment calls were made by the rehearsal.

Screenshots: [Desktop order indicators](evidence/desktop-orders.png), [Mobile chat indicators](evidence/mobile-chats.png).

API regression coverage includes owner authorization/origin checks, cross-store and foreign-message guards, stale order snapshots, monotonic read progress, independent scroll anchors, bot replies, concurrent arrivals and complete pagination through 650 messages. Disposable legacy-upgrade fixtures remove the new tables/index before recreating the older schema; production migration remains strictly additive.

Validation on the combined deployed baseline: all 972 integration tests passed, zero failed/skipped/cancelled (178.3 seconds); production typecheck/build and all four Python catalog cleanup checks passed. Deployment evidence is recorded separately after activation. Actual owner phone/device acceptance remains open in issue #77.

## Deployment

Live release `preview-a98eaa334e98` from tested source `d4330dc59f1a2fabfa66345779265b960515cc35`; exact artifact and actual process directory verified, readiness passed, zero service restarts. Migration 49 is installed. Before/after: 342 products, 18 orders, 745 messages, catalog revision 1978, with no changes to those records or environment bytes (0600). Private backup `owner-20261024T184041Z` passed `pg_restore --list`; the previous release remains available. Exact proof: [DEPLOYMENT.json](DEPLOYMENT.json).

Both hosted implementation checks passed: [branch run](https://github.com/sagomedia/agent-native-whatsapp-bot/actions/runs/40121630369), [PR run](https://github.com/sagomedia/agent-native-whatsapp-bot/actions/runs/40121664528). Review: https://github.com/sagomedia/agent-native-whatsapp-bot/pull/78. Actual owner phone/device acceptance remains pending in #77. Historical records initially have no read receipts, so they appear unread until opened.
