# Import products and edit the catalog

A complete new product can enter the inventory directly from owner chat or the dashboard. The connected agent reads the shop context, checks the exact name/SKU for duplicates, and collects the original product photo, name, seller price, physical stock and selling unit. An explicit zero stock is valid. A zero price requires a free-price status. When pack versus piece is unclear, ask the owner. Use the granted `catalog_add_product` action and retain the operation ID to recover the result of a retry.

## Connect once

During protected owner OAuth consent, the optional **Allow this agent to publish new products and reviewed product edits from chat on my behalf** checkbox is unchecked. Selecting it grants `catalog:publish` in addition to the requested draft permission. The token response and connection record report the actual granted scopes. The authorization page is a one-time permission choice, not a per-product dashboard review.

Existing grants and refresh tokens keep their original permissions. Reconnect and select publication if you want an existing agent to publish. Reading, drafting and publishing remain separate capabilities; a read-only request cannot acquire publication through this checkbox. Revocation blocks subsequent calls and is rechecked inside mutation transactions, including retries. The supported callback URLs, PKCE flow, refresh rotation and modern/legacy MCP routing are retained.

For a trusted local stdio process, publication is disabled by default. An operator can explicitly set `SHOPBOT_MCP_ALLOW_PUBLISH=true` in its private environment file. This is a process trust boundary, not a model argument. Publication also needs an appropriately authorized database role. The existing dedicated inventory/draft SQL role deliberately cannot publish; do not broaden it merely to enable a flag. Re-run its installer after migration 47 for the additional draft review/receipt/image grants, without resetting its password.

## Review an edit

For an existing product or a cleaned-image change, bind the edit to its exact SKU/version, retain the original asset and show the owner the proposed fields and image. Use `catalog_prepare`, `catalog_attach_media`, `catalog_review` and `catalog_commit` with the returned immutable review reference. A material change requires a fresh review. The commit checks product and stock versions, image provenance and publication scope and records a receipt in the same transaction. A family reference or marketing image cannot be the primary product photo. Granting publication permits the connected agent to act on the owner's instructions. Host confirmations still apply.

## File handoff and limits

The file tool advertises `openai/fileParams` for `file` with `download_url` and `file_id`. Direct HTTPS OpenAI file-host downloads are bounded at 2 MB with a 10-second transfer deadline, validated/pinned public DNS, no redirects and normal raster decoding. Signed URLs and tokens are not saved in receipts. The existing bounded byte interface is retained for hosts/integrations that can transfer uploaded files that way. Local filesystem paths are not remote file references.

Host file/image capabilities differ. HTTP/tool contracts and actual raster decoding are tested with synthetic files; a real generated-file transfer in each external app still requires a deployed account test. There is no universal promise that every host can expose its generated file to MCP. Keep the original, save progress or explicitly review the no-photo option when a capability is missing; do not silently claim an image handoff succeeded.

## Direct product import

Products → More → Import products now opens a dedicated import flow. Copy the agent prompt, choose products.json and its exact original JPG/PNG/WebP files, check the preview, then add ready rows directly to inventory. This does not create an owner-facing draft queue. Required facts are name, seller price in rupees, physical quantity, selling unit and original photo. Aliases, keywords, localized names, brand and specifications are optional. The browser shows per-row problems and receipts; it never overwrites an existing product. Stable batchId/item IDs make identical retries safe. A changed saved item must be edited through its current product revision instead of reimporting it.

The file schema, example and agent prompt are shared by dashboard and MCP at packages/contracts/catalog-import.ts. The server converts rupees to integer paise and quantity to canonical stock. Up to 200 rows are checked, with one bounded photo transaction per addition. Exact duplicate names/units, missing facts, malformed image references and invalid selling basis are rejected. Source photos remain retained privately. AI-generated or cleaned photos must use the existing provenance/review workflow instead of masquerading as originals.

MCP catalog_import_guide returns the agent prompt and example; catalog_import_preview checks schema and duplicates without saving; catalog_import_item adds one confirmed row under catalog:publish. The latter accepts bounded photo bytes or supported host file handoff. All imports use the shared direct-add product service, permission checks, store lock, audit and operation receipts.

The main product view removes the draft tab and redundant bulk-update menu. Needs attention filters canonical inventory for hidden products, missing photos, unconfirmed prices, unknown stock or unverified facts. Unknown stock remains distinct from out-of-stock. Legacy staging APIs are retained for compatibility, image provenance and in-chat edits, not as the required result of adding a complete product.

After deploying an updated MCP server, refresh the connection metadata in ChatGPT and start a new conversation. To use direct additions or imports on a previously draft-only connection, reconnect once and select the publication permission on the protected owner consent page. Refreshing tool metadata alone cannot grant publication. No existing grant is silently widened.

For private operator reports, see [developer diagnostics](DEVELOPER-DIAGNOSTICS.md). For owner connections and order operations, see [MCP scopes and tools](MCP-OWNER-WORKFLOWS.md).
