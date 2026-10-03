# Runtime flows and database effects

All flows below are specifications. Contract names and table names are proposed implementation names.

## Shared input contract

NormalizedInput contains eventId, tenantId, actorId/role from trusted context, conversationId, original text, transcript if present, image observations if present, asset IDs, detected language, requested operation, extracted slots, and fields needing confirmation.

Model output is schema-validated evidence/intent. It cannot set authenticated identity or authorize a mutation.

## Text from a customer

1. Verify channel ingress, route channel connection to tenant, and deduplicate the event.
2. Persist inbound message/event and durable job intent; acknowledge the webhook promptly.
3. Worker loads the conversation state and spend policy.
4. Resolve an explicit SKU/button deterministically, or run the customer agent.
5. Agent calls catalog services and gets bounded results. Ask for missing specifications.
6. Persist selected/pending state and outgoing response; record each provider attempt.
7. Sending worker delivers the response and saves external message/delivery identifiers.

Database effects: messages, conversation_state, agent_runs, tool_runs, usage_events, and outgoing_events. Cart tables change only after a validated customer action.

## Customer image upload

1. Verified webhook references provider media; worker downloads it through the authorized channel adapter.
2. Validate type/size; store bytes under a tenant-scoped key and create media_asset plus message_attachment records.
3. Create a media_analysis job with an idempotency key for asset hash, model, and analysis version.
4. Vision adapter returns structured observed category/label/brand/specification evidence and uncertainty. Save media_analysis and provider usage.
5. Search catalog using observed evidence and retrieve a few candidates.
6. Ask for unseen size/thread/material or show choices. Do not turn a candidate ranking into proof of exact identity.

Database effects: attachment + analysis + conversation/search result records. Products, price, and stock do not change.

For a first release, vision-to-structured-text plus SQL retrieval is the baseline. Stored image embeddings and pgvector are a later measured improvement; a 50-product demo does not require them.

## Owner image upload

1. Authenticated owner uploads through the dashboard or an MCP-supported upload flow.
2. Server checks membership and creates a draft-purpose media asset.
3. Image analysis suggests product description/category/specification evidence.
4. Create product_draft or attach the proposed photo to a known product through a change proposal.
5. Owner reviews target and fields, supplies missing authoritative details, and explicitly publishes/applies.
6. Service writes product/asset links transactionally, increments catalog version, and records audit changes.

Database effects before approval: media_assets, media_analyses, product_drafts/change_proposals. Catalog changes occur only through the validated publish/apply service.

An MCP client may not forward attachments automatically. Provide an upload initiation tool and asset-ID workflow; the dashboard always offers a working upload route. Do not copy large base64 files into conversational tool arguments as the default.

## Customer voice note

1. Store audio as a message attachment; record MIME, bytes, and duration.
2. Validate configured duration/format. Preserve a supported OGG/Opus source; normalize through bounded FFmpeg processing only when the selected provider requires it.
3. Audio adapter obtains a transcript and uncertain words/numbers in one structured request. Native Google GenAI is the specified compatibility path if the AI SDK file adapter does not cover the selected audio format/model.
4. Persist transcript and analysis version and capture actual audio-related provider usage.
5. Feed the transcript into the existing customer agent flow; keep the original audio available to permitted staff.
6. Confirm unclear product IDs, sizes, quantities, or units instead of silently correcting them.

Voice notes are asynchronous attachments; no realtime voice-call SDK or speech output is required initially.

## Owner voice to change data

Example command: Change product HW-014 price to 120 rupees.

1. Establish owner identity before processing the recording.
2. Transcribe and extract a proposed operation. Server resolves HW-014 within the owner's store.
3. Create a change_proposal with transcript, exact target, expected product version, current value, proposed 12000 paise, actor, and expiry.
4. Show the before/after preview. If the product identifier or number is uncertain, ask for clarification before creating a ready-to-apply proposal.
5. Owner explicitly confirms that proposal via authenticated UI/MCP.
6. Service checks membership, allowed field, data-source policy, expiry, expected version, and idempotency.
7. Apply in one database transaction, increment version, append audit event, and invalidate relevant search/cache state.

A bare yes only applies when securely bound to one outstanding proposal for that actor/conversation. Changed underlying values require a fresh preview.

The example is hypothetical and does not state the shop's actual product or price.

## Product payments

1. Customer submits an immutable order-request snapshot.
2. Staff verifies availability and approves a quote with exact amount/currency, line items, fulfillment charges/taxes when configured, version, and validity.
3. If payments are enabled, payment service creates or retrieves one Payment Link for that quote using the merchant's provider connection. The model cannot choose another amount.
4. Customer pays through the gateway-hosted page.
5. API verifies the raw signed event, resolves its merchant connection, deduplicates provider event ID, and stores it.
6. Worker validates provider payment/link/quote references, captured or paid state, amount, and currency; fetches provider state if needed.
7. Update payment state transactionally and schedule customer/staff notification.

Acceptance, payment, and fulfillment remain separate states. A redirect or payment screenshot is only a reason to check provider status.

A paid quote that staff cannot fulfill goes into an exception/refund review; it does not automatically reduce billing-source stock or mark fulfillment complete.

## Failures and recovery

Provider timeout before a known result can leave an uncertain external effect. Store the attempt as unknown and reconcile before repeating billable calls/payment-link creation when feasible. Do not claim exactly-once external effects from a queue.

Restart recovery resumes durable work. Replayed messages, proposal applications, and payment events must produce one logical business result. Budget exhaustion or failed media offers text/staff fallback while preserving cart/order state.
