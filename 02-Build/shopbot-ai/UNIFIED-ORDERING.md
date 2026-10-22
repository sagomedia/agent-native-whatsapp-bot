# Unified Flash Lite ordering

Shopping understanding uses gemini-3.5-flash-lite. Set `GEMINI_TRANSCRIPTION_MODEL=gemini-3.5-transcribe` for dedicated voice recognition followed by Flash-Lite text understanding. See [VOICE-TRANSCRIPTION.md](VOICE-TRANSCRIPTION.md) for the current VPS pipeline. With this setting absent, the original combined Flash-Lite audio path remains available.

The new extraction contract is opt-in so existing drafts, cached legacy interpretations and current consent bindings can be preserved while the release is evaluated. Enable these in the existing private configuration:

~~~dotenv
AI_MODEL=gemini-3.5-flash-lite
GEMINI_UNIFIED_UNDERSTANDING_ENABLED=true
GEMINI_HANDWRITTEN_LISTS_ENABLED=true
ALLOW_MULTIMODAL_INFERENCE=true
WHATSAPP_MEDIA_ENABLED=true
WHATSAPP_VISUAL_ORDERING_ENABLED=true
~~~

With handwritten lists enabled, image normalization retains up to 2048 pixels per side while keeping the existing 2 MB cap and stripping metadata. Ordinary photo mode retains the existing 1280-pixel normalization.

Keep existing inference authorization, cumulative AI_BUDGET_USD, recipient allowlist, owner access and WhatsApp credentials. Do not reset or increase the stored allowance to enable this feature. Product-photo search remains available if handwritten lists are disabled. Disabling the new contract uses the legacy interpretation path with Flash Lite for every stage; it never restores a second model.

## Behavior

Text, voice and image understanding return versioned evidence and requested facts, then an adapter invokes the existing validated retail operations. Audio normally takes one identify call with a transcript and semantic extraction. Routine bound actions still require no inference. A second same-model call may ground recommendations or repair a text/audio proposal; images with invalid action evidence stop without partial writes.

Product photos are read-only discovery inputs. A handwritten list can create proposed draft lines, including a visible unreadable-line placeholder. Every requested line stays reviewable. Image content cannot authorize submission or modify existing cart lines. Corrections require the customer's text, voice or a current action.

Counts, pack contents, physical amounts, dimension roles and budget constraints remain separate. Fractional sizes are parsed as whole fractions. A source marked quantity-uncertain remains unknown, even when older recovery logic sees a digit. Budget proposals use verified shop pricing, selling basis and increments. Price changes recompute budget-derived counts; missing prices remain pending.

Complete product reviews include every line. Mixed store questions survive the visual renderer. Unresolved items can be deferred while others progress. Submitted orders remain immutable; post-submission amendments go to the owner through the existing help workflow. Voice/text/button completion keeps the prepared current-review, stale-event and exactly-once checks.

## Offline verification

Use a disposable local PostgreSQL database and run the integration suite plus npm run build. Controlled provider responses test backend behavior; they do not measure recognition accuracy.

## Metered real-media evaluation

scripts/evaluate-unified.ts accepts a dataset of text/audio/image journeys, uses only Flash Lite and processes them through the same runtime and attempt ledger. It creates a fixed flash_lite_evaluation schema in a dedicated local database whose name ends in _test. Its allowance and attempts persist across runs. It never connects a WhatsApp recipient or sends customer messages.

Set the existing authorized Gemini key and an explicit evaluation allowance in your environment. The command does not print the key. A zero-network configuration check is:

~~~sh
node --import tsx scripts/evaluate-unified.ts --preflight
~~~

For actual inference:

~~~sh
APP_MODE=mock node --import tsx scripts/evaluate-unified.ts --fixtures /absolute/path/to/cases.json
~~~

DATASET EXAMPLE — the sample filenames are placeholders, not measured recognition evidence:

~~~json
{
  "cases": [
    {"id": "two-ten-litre-cans", "messages": [{"kind": "text", "text": "two 10 litre white paint cans"}], "expected": {"orders": 0}},
    {"id": "tamil-recording", "messages": [{"kind": "audio", "path": "recording.ogg", "mimeType": "audio/ogg"}]},
    {"id": "handwritten-list", "messages": [{"kind": "image", "path": "list.jpg", "mimeType": "image/jpeg"}]}
  ]
}
~~~

Media paths resolve from the dataset directory. Text fixtures should name products in the evaluation catalog, or expect unresolved items. Images and recordings require the existing byte/duration limits. The report preserves evidence, actual draft/order state, failed attempts, elapsed times and cumulative budget accounting. Cases without expectations are recorded as observed, not passed. Results are local under artifacts/unified-evaluation and may contain the supplied media's text.

## Integration

This work was built from the consistent prepared 12 October voice-operations source. Reconcile the delta against the active/canonical release before deployment; do not overwrite newer work with this recovered copy. Keep the prior running release and data backup. No new dependencies are required. Understanding evidence lives in existing attempt response JSON and draft metadata; the image-storage migration below supports larger list images.

Migration 26 widens the stored image dimensions from 1280 to 2048 pixels; it preserves all existing image bytes and the 2 MB limit. It is idempotent and compatible with the previous runtime for rollback.

Native WhatsApp and fresh Gemini recognition need a separate pilot after staging. The implementation's offline tests and built assets are not a claim that this release is live.

## Recorded-chat repair

Prompt version 2026-10-13.2 distinguishes repeated mentions from distinct products. Text/audio items may reference a current targetLineId or an earlier sameItemOrdinal. The adapter joins compatible count/dimension evidence, updates unique existing totals, and reserves increments for explicit extras. Conflicting variants or several matching existing lines require a targeted clarification. Images cannot use these fields to edit a cart or collapse handwritten rows.

Water/watering hose and garden hose are grounded synonyms; paint scraper and scraper share a lookup identity. Quantity questions on confirmed visual items precede unmatched lines, and replies expose the known subtotal plus exclusions. A queued owner-wait notice is sent once per handover and cancelled when an owner reply supersedes it. Assistant resume refreshes the pending question and registers current WhatsApp action bindings, with all reply parts retained.

The two-minute recorded wait was owner mode: the owner returned control two seconds before Gemini started. This release explains that pause rather than overriding it. No additional migration or model is required for this repair.
