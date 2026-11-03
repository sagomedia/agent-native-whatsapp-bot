# Inventory-grounded visual shopping

## Current flow — 3 November 2026

The agent interprets product meaning and chooses the next useful distinction. PostgreSQL supplies current store facts; services enforce IDs, dimensions, selling units, counts, versions, consent and arithmetic. There is no category-specific brand → pack → price decision tree.

The inventory-grounding pass can supply `narrowing: [{key, question}, …]`, an ordered strategy over useful observed attributes in the saved customer language. Actual brands, arbitrary recorded specifications and numeric price bands are facts available to the agent, not a required order. A strategy and sampled SKU selection are exclusive. The agent must not invent tiers or restrict a broad result to its small SKU sample. Compact observed selections support up to ten SKUs.

Each tap queries current inventory, retains explicit filters and skips attributes with no remaining choice. Continuation stays on the same attribute. When no valid planned step remains, the customer can choose among the remaining real details visually; a new text/voice request can create a new metered semantic plan. Deterministic browse without an agent strategy uses the same honest detail chooser. Buttons add no inference calls.

Facets aggregate the full matched SQL scope: up to twelve attribute keys and nine values per page. The chosen page fetches genuine example products from the full scope, including beyond the 120-row ranker sample. Price bands use distinct positive known prices, verified selling units and a common selling unit. Unknown/confirm prices do not form price choices. A price band is not evidence of quality and never changes purchase count.

Nine visual choices plus continuation fit one carousel. Pack sizes are large text when no actual example photo is available; example photographs are labelled. A group click filters inventory, a product click selects that observed SKU, and purchase count remains separate from pack size. `browseAll` pages actual products when useful distinguishing metadata is absent. SQL cursors advance beyond the 120-candidate sample. Missing photos use descriptive cards, without unrelated or invented filler.

Cart reviews split into ordered groups of at most ten cards. Native carousel buttons have uniform counts while retaining item approval/edit controls. Every required part must be delivered before approval. Typed renderer errors persist `render_<code>` diagnostics and offer a read-only saved-list recovery. Undisplayed consent is invalidated; retrying cannot approve or submit.

Aliases and taxonomy may be wrong. Grounding compares actual names/specifications. Verified SKU selections cannot be intersected with an unrelated family inferred from a size-stripped alias. Dimensions and explicit filters still constrain those SKUs. Empty retrieval preserves the description and does not establish shop unavailability.

Current provider IDs and prompt revision live in `packages/contracts/model-policy.ts`. Read the root `AGENT-HANDOFF.md` and `LOCAL-DEVELOPMENT.md` for current allowances and local operation. Dedicated speech recognition receives language hints and audio without cart/catalog history; semantic grounding uses the transcript and current inventory. Keep private recordings ignored and respect their replay authorization. Controlled tests verify runtime behavior, while actual model decisions and native phone rendering remain owner acceptance in issue #88.

## Historical prototype notes

The remainder records the earlier prototype and its then-current limits/provider setup. The current flow above supersedes its product counts, one-reply/free-only assumptions and unimplemented-WhatsApp milestone descriptions.

The reusable runtime uses store identity/type → departments → product families → brands/specifications → actual SKUs. The hardware demo map is data in `resources/catalog/ksmc-demo/catalog-map.json`; the retrieval engine contains no hardware category or fixture-store IDs.

## Retrieval and conversation

`get_catalog_map` returns actual scoped counts and a bounded map. `discover_products` accepts a customer query and a typed plan with up to eight keywords, optional real department/family IDs, brand and specification constraints. Full-text and trigram indexes retrieve at most 120 candidates; the backend ranks them and returns up to three real products. Ranking weights are ordering scores, not correctness probabilities. Facets aggregate the whole matched SQL scope, including brands outside the candidate sample. Explicit type, brand and numerical specifications are hard constraints, including when a SKU is supplied.

The model receives a bounded catalog sample (24 products for hierarchy-enabled stores), the map, conversation state and real tool observations. It proposes keywords and operations; it cannot author prices, product names, image URLs, unit conversions, stock promises, product acceptance or order submission.

Broad “blade” queries can show saw blades, metal cutting discs and a clearly labelled related scraper. A category button then narrows to real brands or sizes, without another model request. Exact products can show compatible peers where available; there is no invented filler image. Empty exact retrieval retains the request and asks about the job or shows labelled related suggestions. It does not establish shop unavailability. Every requested list line remains separate.

Product checks show at most three request groups and ten photos in one outbound envelope. Selecting a current photo accepts that actual SKU for that line; remaining groups appear in the next check. Missing quantities remain questions. Final review/submission uses a separate current consent binding. Changed product identity, stale batches, stale refinements and cross-store requests are rejected.

## Recorded voice

On `/native-test`, Record voice → Stop recording → listen to the preview → Send voice. The microphone runs only after the customer presses Record. It stops automatically before 30 seconds and releases its tracks. The customer can cancel before sending. Microphone permission or browser support failures leave text entry available.

The signed local voice route accepts only bounded uploaded audio bytes. FFmpeg decodes from stdin with network/filesystem protocols disabled, a five-second execution limit and a bounded mono 16 kHz output. Server-measured duration must be 0.2–30 seconds; silent or malformed audio is rejected before AI. A source hash binds retries to identical uploaded content. Normalized WAV bytes and metadata are stored transactionally in `voice_media`, scoped to the authorized store/conversation/actor, together with the durable inbound event. Scoped playback uses the same signed session. Raw audio/base64 is not stored in message history or Git.

One free-only Gemini request transcribes audible speech and extracts the same typed shopping plan. Text context is capped independently of audio. Missing/invalid transcripts or invalid batches make no draft changes; rate limits preserve the list. Audio cannot approve products or submit orders. Quantity replies spoken as voice require transcription; typed quantities and catalog/refinement buttons can use zero AI calls.

Paid text pricing is not reused for audio: the adapter rejects audio outside its free-only configuration. Existing project-wide limits remain three calls/minute, 15-second spacing and 100/day with no hidden retry or paid fallback. Each conversational turn produces one outbound reply.

## Adding another store

Create a store-scoped `catalog_profiles` row; insert department nodes, then family nodes with curated nature/job aliases into `catalog_nodes`. Associate products through `family_id`, record actual `brand`, JSON `specifications` and product-specific `keywords`, and keep name/price/unit/image/version authoritative. Do not copy every department/family alias into every product. Update product identity/version on changes. Import these records transactionally using authenticated merchant tooling at that future milestone. A store without a hierarchy keeps the original compatibility path.

The isolated grocery fixture verifies the same engine against 10,000 products: bounded candidate retrieval, complete brand facets, rare-brand filtering, indexed family/brand constraints and tenant isolation. This is a controlled fixture, not a production load benchmark. High-cardinality facet summaries are bounded; a merchant should curate the tree and verify candidate quality before onboarding a real catalog.

## Channel boundary

This phase supplies reusable recorded-media normalization, structured interpretation, catalog tools and consent controls. `/native-test` is the local harness. Actual WhatsApp media download, webhook verification, delivery eligibility/templates, owner approval and customer delivery remain separate integration milestones.

Official provider references checked for this implementation: [model audio support](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite), [GenerateContent audio input](https://ai.google.dev/gemini-api/docs/generate-content/audio). The existing pinned SDK uses inline audio and JSON mode with strict backend wire/canonical validation, one SDK request and automatic function calling disabled. The expanded provider grammar was rejected; the compact planning contract is supplied in the instruction instead. See the verification report for the diagnostic history.
