# Catalog upload recovery (MCP 1.5)

Complete new products use `catalog_add_product`: original photo, name, seller price in paise, physical stock and selling unit. Missing facts stay in chat. There is no separate new-product draft or dashboard approval step.

The default HTTP and stdio servers no longer advertise `catalog_propose`, `catalog_drafts`, `catalog_edit_draft` or `catalog_stage_photo`. `catalog_prepare` now requires an existing product base/version or an existing edit ID/version. `catalog_get_edit` replaces `catalog_get_draft`. Older records remain available by ID; no migration or data deletion is involved. Internal transactional staging and existing-product image review remain in use.

## Image transfer

Call `catalog_media_capabilities` for the exact contract. Two supported forms:

- `file`: a host file object with `download_url` and `file_id`; optional `mime_type` and `file_name`. All four properties are declared for OpenAI fileParams compatibility. The existing HTTPS host allowlist and pinned public-address checks remain enforced.
- `photo`: `{id, mimeType, data}` where data is raw Base64 of the actual raster file, not a path, URL, data URI or stringified object. Maximum 2 MB decoded; JPEG, PNG and WebP only.

An agent-local `/mnt/data` file is not a remote upload. The host bridge must transform it into an actual file reference, or the client must read and encode its bytes. Shell access is not required by MCP itself; a client still needs a functioning file bridge or byte-transfer capability. Do not fabricate a file ID or URL. A host without either capability cannot complete that upload; report the limit and keep facts in chat.

MIME type is detected from the raster signature, then the image is fully decoded, stripped of metadata and prepared into all preview sizes. A valid WebP incorrectly labelled JPEG is corrected. Unsupported or corrupted bytes are rejected; detection does not bypass decoding.

`catalog_validate_photo` tests both transfer and full processing, returning MIME, byte count, SHA-256, dimensions and preview count. It saves neither a product nor a draft. Use it for diagnosis rather than making every successful product addition take two decode passes.

## Failure recovery

Failed add, media-attachment and import operations return a safe error code, message, stage, operation ID, reference ID and recovery instructions. A sanitized failure record is written to owner_audit after the business transaction has rolled back. It contains no image bytes, signed URL, token or raw tool arguments. A database outage may prevent this best-effort record; the original tool error is still returned.

`workflow_status` returns `{operation, failure}` scoped to shop and agent. A successful receipt takes precedence over an earlier failure. A null success receipt alone does not prove the request never reached the server. SDK-level input validation may reject a request before the operation handler runs.

After a failed photo transfer, check workflow_status, correct the transfer and reuse the same operation ID. After success, identical retries replay the saved receipt and do not create another inventory item. A changed successful request still produces an idempotency conflict.

No automatic grant upgrades, arbitrary URL fetching, customer messaging or AI inference are added. Existing products retain revision and inventory checks.

## Verification and rollout

Tests use a separate localhost PostgreSQL database and random disposable schemas. Verify corrupt files, MIME correction, draft-tool retirement, OAuth HTTP attachment failure/recovery/direct publication, original-byte retention, same-ID replay, actor-isolated failure lookup, read-only authorization, imports and stdio.

Before integration, compare this commit against the latest deployed/shared source and apply only this patch. No schema version is allocated because existing audit storage is reused. Rebuild the server, preserve private environment configuration, verify the release fingerprint and run authenticated read-only tool discovery. Refresh tools in connected clients because the tool list changed. A cached old tool list is not evidence of the new server contract.

The exact M-Seal JPEG and two WebP files from the failure reports passed the new decoder in a separate VPS proof directory, including a deliberately incorrect MIME label. This proves server-side handling, not a completed live ChatGPT UI attachment transfer. The original failed request payload is unavailable, so its exact historical cause remains unconfirmed.

Reference: https://developers.openai.com/plugins/reference (File APIs / Define file inputs).
