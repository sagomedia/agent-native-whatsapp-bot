# ShopBot product guide

The customer shops in WhatsApp. The shop owner manages Orders, Chats, Products and Settings in the web dashboard. Both environments run the same Fastify server, React dashboard, PostgreSQL store and Gemini adapters. Start with the [local connection guide](../LOCAL-DEVELOPMENT.md) or the [existing VPS runbook](../deploy/native/README.md).

## From a message to an order

1. A signed WhatsApp webhook binds the message to a shop and sender. Inbox processing claims a turn, deduplicates retries and loads the conversation, customer language and draft. New conversations start in Tamil, with the shop’s configured welcome audio where enabled. Customers can explicitly switch to Tanglish or English.
2. Gemini interprets text, voice or photo against the current task. For dedicated voice recognition, FFmpeg normalizes the recording, the recognizer receives audio with saved-language hints, and a separate understanding step uses the transcript and shopping context. Keep the original evidence separate from inferred product names and edits. The backend binds typed operations to current cart rows, rejects negated or unsupported actions and validates versions. A failed interpretation leaves the list intact.
3. Search uses the shop’s current SKU, name, aliases, specifications, dimensions and selling units. For broad requests, Gemini chooses useful distinctions observed in those results. Tapping a group filters the real matches and reuses saved state. A labelled group photo illustrates the choice. Generate and cache instruction cards locally. A single product can have its own photo card, and two to ten relevant choices fit a carousel. Larger sets page with up to nine choices plus continuation. Missing photos use descriptive cards. Poor aliases must not rule out an explicitly matched SKU.
4. Preserve every requested line while resolving one item at a time. Use the customer’s existing count, keep pack size distinct from purchase quantity, and clarify the particular unknown item or edit. Repeated named quantities mean totals unless the customer asks for an additional amount. Respect the catalog selling basis and increments. Prices and totals use integer paise. Clear compound edits preserve unrelated items. Keep ordinary orders under fifteen turns where practical and measure actual inference and messaging use.
5. Product selection, approval of the displayed product and final submission are distinct actions. Reviews bind to the current order version. Each part of a multipart review must reach the customer before approval. A saved-list recovery action can redisplay the list. The customer can edit after viewing an estimate. With partial review enabled, unresolved items keep their descriptions and counts for shop review and are excluded from the known subtotal.
6. The owner reviews the request, records a quote or changes, handles customer approval where required, marks the order ready and records pickup. The reviewed bill can be sent as an image and the final invoice as a PDF. Staff can create in-store orders without a WhatsApp conversation. For tracked stock, acceptance reserves available units, cancellation releases reservations and collection consumes them. Order approval, stock, payment and physical pickup are separate facts.

For amount conversions, cutting versus whole pieces and corrections, read [selling units and requested amounts](QUANTITY-AMOUNTS.md). For the recording pipeline and budget accounting, read [dedicated transcription](VOICE-TRANSCRIPTION.md). For public sender admission and owner takeover on the VPS, read [WhatsApp audience and admission](PUBLIC-CUSTOMERS.md).

## Owner tools

The dashboard supports chat takeover, inventory edits, stock movements, photos, bulk import, order review and shop hours. Complete products can enter inventory directly. Review uncertain matches and changes against the actual product and version. Dashboard and authenticated MCP operations respect the same store, permissions and audit trail. Each grant determines the available tools. See [catalog import and editing](CATALOG-CHAT.md), [owner tools and permissions](MCP-OWNER-WORKFLOWS.md), [reviewing AI suggestions](RSI-REVIEW.md) and [morning preparation](SHOP-OPENING.md).

## Where to change behavior

| Area | Source |
| --- | --- |
| Webhook verification, delivery, inbox jobs and recovery | [HTTP ingress](../apps/server/src/http/whatsapp.ts), [worker](../apps/server/src/jobs/whatsapp.ts), [channel](../apps/server/src/services/whatsapp-channel.ts) |
| Model selection, transcription and typed interpretation | [conversation runtime](../apps/server/src/runtime/conversation.ts), [model policy](../packages/contracts/model-policy.ts), [adapters](../apps/server/src/adapters), [shared contracts](../packages/contracts) |
| Search and narrowing across the shop’s inventory | [grounding](../apps/server/src/services/inventory-grounding.ts), [catalog discovery](../apps/server/src/services/catalog-discovery.ts) |
| Cart edits, approvals and customer-visible cards | [shopping flow](../apps/server/src/services/shopping-flow.ts), [visual ordering](../apps/server/src/services/visual-ordering.ts), [WhatsApp replies](../apps/server/src/services/whatsapp-reply.ts) |
| Orders, quotes, stock and owner UI | [quote service](../apps/server/src/services/order-quotes.ts), [inventory service](../apps/server/src/services/inventory.ts), [dashboard source](../apps/dashboard/src) |
| Catalog intake, owner MCP and datastore | [database and migrations](../apps/server/src/db), [MCP implementation](../apps/server/src/mcp), [operator prompts](../resources/mcp) |
| Regression tests and phone acceptance | [tests](../tests), [catalog replay](CATALOG-QUALITY.md), [customer and owner test prompts](CUSTOMER-AND-OWNER-TEST-PROMPTS.md), [phone acceptance issue](https://github.com/sagomedia/agent-native-whatsapp-bot/issues/88) |

Durable inbox and outbox records, versioned actions and queue leases protect against duplicate work. Treat unknown delivery outcomes as pending reconciliation. A WhatsApp API acceptance, a delivery callback and a successful customer tap are separate observations. Actual merchant pricing, photo identity, speech recognition and phone rendering need evidence from the intended shop and device.
