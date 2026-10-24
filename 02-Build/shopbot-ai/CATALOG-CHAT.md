For the current direct-add flow and separate internal diagnostics, see [OWNER-WORKFLOWS.md](OWNER-WORKFLOWS.md).

# Product creation and editing in chat

The MCP server now supports in-chat product review and publication through the same proposal/product services used by the owner dashboard. No new model provider is installed. The host app performs optional language enrichment and image editing with its own capabilities.

## Connect once

During protected owner OAuth consent, the optional **Allow this agent to publish new products and reviewed product edits from chat on my behalf** checkbox is unchecked. Selecting it grants `catalog:publish` in addition to the requested draft permission. The token response and connection record report the actual granted scopes. The authorization page is a one-time permission choice, not a per-product dashboard review.

Existing grants and refresh tokens keep their original permissions. Reconnect and select publication if you want an existing agent to publish. Reading, drafting and publishing remain separate capabilities; a read-only request cannot acquire publication through this checkbox. Revocation blocks subsequent calls and is rechecked inside mutation transactions, including retries. The supported callback URLs, PKCE flow, refresh rotation and modern/legacy MCP routing are retained.

For a trusted local stdio process, publication is disabled by default. An operator can explicitly set `SHOPBOT_MCP_ALLOW_PUBLISH=true` in its private environment file. This is a process trust boundary, not a model argument. Publication also needs an appropriately authorized database role. The existing dedicated inventory/draft SQL role deliberately cannot publish; do not broaden it merely to enable a flag. Re-run its installer after migration 47 for the additional draft review/receipt/image grants, without resetting its password.

## Conversation

Owner: “Add this cutter, ₹250 each.” [photo]

Agent: Reads context, searches existing inventory, prepares a draft and optional aliases. It can use the host's image tools to clean the background, retaining the original.

Agent: Shows the name, aliases, ₹250 per piece, original/cleaned photo and any genuinely missing facts.

Owner: “Use the cleaned photo. Add pruning scissors as another name. Publish.”

Agent: Applies the correction, creates a new review and commits that exact review under the granted owner permission. The dashboard remains available but is not required for this review.

## Tools

Existing search, inventory, draft list, propose, edit_draft and stage_photo tools remain available for compatible clients. New tools:

- `catalog_context`: resolved shop, permissions, actual taxonomy and workflow policy.
- `catalog_get_draft`: one current draft, missing facts and actual image previews.
- `catalog_prepare`: create or patch a draft, including an existing SKU/version edit target; operation receipts support identical retries.
- `catalog_attach_media`: bounded raster bytes or an actual supported host file reference, with original/cleaned/marketing provenance.
- `catalog_review`: a product card, selling basis, before/after fields, selected image preview and an immutable 30-minute review reference. Missing requirements produce focused questions.
- `catalog_commit`: publish an exact current review under a publication grant. It is exposed only to publication-capable connections.

Read-only grants expose five read tools; draft grants expose eleven tools; publication grants expose twelve. `add_product` and `edit_product` MCP prompts and `catalog://owner/workflow` provide reusable guidance. A standalone skill is included at `resources/mcp/catalog-management/SKILL.md`. Hosts choose whether to use prompts/skills; tool descriptions and explicit structured next steps also guide ordinary conversations.

## What review means

A review binds the shop, connection actor, draft version, base product/inventory versions, final normalized fields, selected asset hash/classification and photo-omission choice. A material change invalidates it. Product updates retain their SKU and use the existing inventory checks, so a stale draft cannot overwrite a newer count or reservations. Mutation receipts and catalog writes are atomic; a retried commit returns its original result without publishing twice.

The owner grants the agent permission to act on their instructions. The server records publication as an **agent action under a delegated owner grant**. It does not claim that a model-generated Boolean, possession of a review ID or an agent tool call independently proves a human clicked approval. Host action-confirmation controls remain in force. There is no fake `approved: true` argument. Clients can show the review as conversation text/images and their native confirmation UI; this change does not require a custom widget or elicitation implementation.

Primary product photos must be declared exact originals or cleaned versions of an exact original. Marketing images and uncertain/family-only photos cannot be primary. The raw uploaded bytes and hashes are preserved. Cleaning does not establish product identity; the server enforces declared provenance relationships, not visual truth. The owner/host still reviews whether an image actually depicts the intended product.

Current business policy is preserved: seller-supplied prices are authoritative, unknown stock stays unknown, and an explicitly chosen price-to-confirm status is distinct from free. New products may be published without a photo only when the reviewed action explicitly selects that existing policy option. An edit can preserve its current photo without re-uploading it.

## File handoff and limits

The file tool advertises `openai/fileParams` for `file` with `download_url` and `file_id`. Direct HTTPS OpenAI file-host downloads are bounded at 2 MB with a 10-second transfer deadline, validated/pinned public DNS, no redirects and normal raster decoding. Signed URLs and tokens are not saved in receipts. The existing bounded byte interface is retained for hosts/integrations that can transfer uploaded files that way. Local filesystem paths are not remote file references.

Host file/image capabilities differ. HTTP/tool contracts and actual raster decoding are tested with synthetic files; a real generated-file transfer in each external app still requires a deployed account test. There is no universal promise that every host can expose its generated file to MCP. Keep the original, save progress or explicitly review the no-photo option when a capability is missing; do not silently claim an image handoff succeeded.

## Schema and integration

Additive migration **47** adds asset provenance and review/operation receipts. The number is allocated against source `274e73b` (schema 46); reconcile it again against the latest source at integration. Existing products, orders, connections and assets are retained. A migration-number collision is rejected. The existing prior-schema upgrade rehearsal was extended to include these additive tables.

Implementation and tests are isolated from other chats and deployed services. No live catalog publication, grant upgrade or deployment was performed. Integrate only this patch onto the latest source, verify migration numbering and current release state, run the combined regression suite and retain a database backup before activation. The current connected app remains unchanged until activation; existing accounts must opt in before they see `catalog_commit`.

Selected-batch approval, relative stock-receiving tools, archive/restore tools and undo/history were design extensions, not new MCP operations in this first implementation. Product field/alias/price and explicit stock-count edits are supported through versioned proposals. Supplier/shelf-photo preparation can feed the same workflow without a new ingestion service.
