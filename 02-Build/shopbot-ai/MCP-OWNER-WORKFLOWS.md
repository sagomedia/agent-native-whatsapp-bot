# Owner MCP workflows (1.6)

The merchant can inspect the same retained orders, customer inbox, catalog and operational evidence used by the dashboard. The connected AI application supplies the language summary; the MCP makes no paid model call. Complete product additions continue directly into inventory. No new-product draft step is introduced.

## Permissions and discovery

Existing catalog grants keep exactly their permissions. `owner_capabilities` is discovery metadata available with catalog read. Private orders, customer messages and business operations require the **owner access** checkbox on a new OAuth connection (`owner:read`). The consent explains that retained shop conversations are shared with the connected AI application. The separate **order updates** checkbox adds `orders:write` and requires owner access. Requested scope strings alone do not grant either permission. Refresh preserves granted scopes; disconnect/revocation blocks future calls.

Catalog publication remains its separate opt-in. Trusted stdio has `SHOPBOT_MCP_ALLOW_OWNER_READ=false` and `SHOPBOT_MCP_ALLOW_ORDER_WRITE=false` defaults. Enabling flags also requires a separately authorized database role. The dedicated catalog draft role stays restricted; its installer does not widen access. Never accept shop/actor/grant identity in tool input.

Default tool counts: catalog read **12**, catalog edit **15**, catalog publication **20**. Owner read adds **13**, and owner order updates add **7**. A connection with every supported permission has **40** tools. Tools are filtered at discovery and grants are checked again at invocation. Refresh cached tools after deployment; reconnect to choose new permissions.

## Tools and why they exist

| Tool | Permission | Purpose and end-to-end use |
|---|---|---|
| `owner_capabilities` | catalog read | Establish actual connection permissions and route to available workflows; never implies that a missing permission was granted. |
| `owner_dashboard` | owner read | Start a daily review: shop control state, open orders, ready orders, inbox help, stock/catalog attention and dated order counts. |
| `orders_list` | owner read | Find pending work first, then filter ready/completed/cancelled/history, search order/product/customer names and page results. |
| `orders_get` | owner read | Read one exact order's original/effective lines, revision, amendments, quotes, saved quote, advance state and inventory holds before an edit. |
| `orders_summary` | owner read | Answer “how many today?” with exact local-calendar UTC cutoffs and distinct submitted/accepted/pending/ready/collected/cancelled counts. |
| `conversations_list` | owner read | Find recent or historical customer discussions; `needsHelp` shares the dashboard's actual handoff/reply logic. |
| `conversations_get` | owner read | Read chronological message pages and delivery states; page `olderCursor` for earlier evidence. |
| `conversations_summary` | owner read | Supply dated counts and bounded cited evidence, order references and observed execution failures for a private host-AI summary. |
| `owner_operations` | owner read | Reuse dashboard pending-work, delivery/media failure, catalog-gap, budget/inference, cost-estimate and release evidence. |
| `owner_activity` | owner read | Page action names, target IDs and timestamps without disclosing raw OAuth/audit details. |
| `owner_store` | owner read | Inspect business name, control revision, inventory policy, product confirmation and this process's release metadata. |
| `catalog_attention` | owner read | Use the dashboard's cursor/filters for low/out/unknown stock, incomplete facts, missing photo/price, hidden products and family/brand. |
| `catalog_stock_history` | owner read | Page on-hand/reserved inventory movement history and reasons before reconciling a count. |
| `catalog_import_history` | owner read | Page intake batch history; direct conversational imports also have activity/operation receipts. |
| `catalog_adjust_stock` | catalog publish | Count/restock/record a sale from seller facts and the current inventory version, retaining reservations and one receipt per operation. |
| `catalog_set_visibility` | catalog publish | Archive or restore by product version. Restore runs publication validation; originals and history remain. |
| `orders_review` | order write | Review every current line with seller facts; save, revise bill or mark ready after the seller confirms physical products. |
| `orders_decide` | order write | Accept/reject an awaiting order using dashboard payment-state, quote, amendment and inventory guards. A refund-pending marker is not a refund. |
| `orders_fulfillment` | order write | Move an accepted order to ready/collected/cancelled with expected status and revision. Packing and inventory checks remain enforced. |
| `orders_complete` | order write | Record actual collection of a ready accepted order once, consuming the appropriate reserved inventory. |
| `orders_save_quote` | order write | Save an incomplete quote for existing lines using current order and saved-quote versions. |
| `orders_offer_quote` | order write | Create the dashboard's revision-checked final quote, preserving required customer approval. No message is sent by this connector. |
| `orders_decide_amendment` | order write | Decide an actual customer-confirmed amendment; preserve revision, line identity, stock and cancellation rules. |

Existing catalog discovery, duplicate checks, direct additions, imports, photo validation/attachment, revision-checked edits and commit tools remain available under their original permissions. `workflow_status` recovers successful catalog or order operation receipts for this agent.

## Examples and important semantics

“இன்னைக்கு எத்தனை order? Pending என்ன?” → `owner_dashboard` / `orders_summary` with timezone Asia/Kolkata, then `orders_list` with its default pending filter. Report the returned dates. “Today” is a local calendar day, not the last 24 hours. DST day lengths come from PostgreSQL timezone handling. Counts classify orders **created** in that interval by their **current** state; collected is not a count of timestamped collection events. Values are INR-paise order estimates, not paid revenue. Incomplete estimates remain explicit.

“இந்த customer என்ன பிரச்சனை சொல்றாங்க?” → `conversations_list` → `conversations_get` or `conversations_summary`. Summarize requested products/aliases, unanswered questions, handoffs, observed failures and possible UX gaps. Cite actual conversation/message IDs and distinguish evidence from hypotheses. Private ChatGPT history, hidden model reasoning and deleted/unrecorded messages are unavailable. Summary counts cover the selected period; case/message pages and text may be partial. Return coverage, older cursors and next pages. A 60,000-character summary text budget prevents unbounded context. Sensitive-looking tokens and signed URL queries are minimized, not guaranteed anonymous.

“Mark this order ready” → `orders_get` → ask for the seller's actual physical check → `orders_review` or `orders_fulfillment`. A model Boolean is not separate human approval. Host confirmation and owner instruction remain authoritative. Use a stable operation ID. On uncertain response read `workflow_status`; unchanged retries replay the receipt. On stale revisions reread and reconcile. All order mutations use shared dashboard services and the store lock/audit/receipt transaction.

`orders_save_quote` deliberately preserves the dashboard quote editor format: `quantity` and INR-rupee `price` are strings, `free` is a Boolean and `saleMode` is `''`, `pack` or `measured`. Final review/offer fields use numeric quantity and integer `pricePaise`. Read the tool schema and do not reinterpret rupees as paise.

## Deliberate boundaries

Order writes in this connector never send customer messages. A saved or offered quote is not proof of delivery or customer approval; explicitly tell the owner when notification remains. Customer messaging, payment verification/refunds, global pause/conversation takeover, business-name changes, credentials/access settings and message-gallery previews remain dashboard workflows. They are not secretly executable through the read tools. No hard-delete, arbitrary SQL/shell/HTTP tools or automatic external developer reports are supplied.

The internal diagnostics MCP remains separate with its own operator credentials and private report storage. Owner discussion evidence may support suggested investigations, but neither a tool nor a prompt proves a bug was reproduced. Summaries do not enter customer response generation.

## Verification and integration

No schema migration is required. Existing audit and operation ledgers hold write receipts. Tests cover explicit consent, old-grant isolation, refresh/revocation/expiry, foreign-shop IDs, local-day/DST bounds, pending work and pagination, effective order details, bounded transcripts and injection-as-data, truthful summary coverage, stock retries, restore validation, all order actions, HTTP and real stdio.

Keep source isolated from the other chat. Before deploying compare the latest live release/source hashes, apply only these changes, preserve private configuration and use the verified native upgrade with backup/rollback. This implementation does not fix the separately observed `unsupported_file_handoff`; that still needs the actual ChatGPT reference format. Do not claim a server photo-decoder test proves host attachment handoff.
