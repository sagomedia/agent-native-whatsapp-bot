# Multilingual, voice and image audit

3 October 2026. Runtime at `http://localhost:3017/native-test`.

## Changes verified

- Unicode normalization now preserves combining marks (`\p{M}`), including Tamil vowel signs. The added regression verifies intact Tamil text and real SKU lookup: பைப் பசை → H07, கட்டிங் வீல் 4 இன்ச் → H14/H15, வாள் பிளேடு → H16.
- Voice players changed from `preload="none"` to `preload="metadata"`, so browsers can show duration before playing. In the existing browser, before restart, the user's recording played: duration 5.4 s, readyState 4, currentTime advanced, no audio error. No new microphone capture or personal voice inference was performed in this audit.
- All 30 current demo image URLs returned HTTP 200 JPEGs with valid JPEG signatures. Updated browser browsing displayed three decoded real photos (H14, H15, H16), with an empty draft. This uses deterministic tools and no model call. Screenshot: `013-photo-preview.png`.
- Docker build includes successful typecheck/dashboard/server compilation. Full suite: 83/83 tests passed in isolated schemas, using offline/scripted provider transports. No customer database reset.

## Live free-tier checks

| Synthetic sample | Provider outcome | Draft / photos |
|---|---|---|
| English: “I want two cutting blades. Which types do you have?” | `invalid_operations` | Empty draft preserved; no products added |
| Tamil: “எனக்கு இரண்டு கட்டிங் பிளேடு வேண்டும். என்ன வகைகள் உள்ளன?” | `invalid_operations` | Empty draft preserved; no products added |
| Tanglish: “Enakku rendu cutting blade venum. Enna types irukku?” | Succeeded | Quantity 2; unresolved cutting blade; real H14/H15 choices; English reply |

Three actual ledgered free attempts, no hidden retries, no paid inference, and no order submission. Usage totals: 6,038 + 6,011 + 5,990 = 18,039 provider-reported tokens. Fifteen-plus seconds between requests; standard shared project quota remained enforced. These are three smoke tests, not a broad language benchmark. The invalid provider decisions were not persisted as valid responses, so their exact failure fields cannot be reconstructed from this audit; the next fix should expose bounded validation diagnostics safely and test the planning contract.

The separate existing Tamil transcript in the user's submitted conversation is evidence that Tamil audio has reached transcription previously. This audit verified its playback; it did not perform a fresh Tamil/English/code-switched voice accuracy benchmark. Automatic approval review rejected resending the user's personal recording to Google Gemini without explicit payload/destination authorization. A pending question asks for that authorization; the safer completed alternative sent only authored synthetic text.

## Findings requiring the next implementation

1. Plan validation failed on ordinary English and Tamil inputs. Fix the adapter/instruction contract and add representative mixed “order + show types” cases; preserve atomic validation rather than accepting arbitrary model output.
2. Backend copy remains English. Add preferred language, reviewed semantic message keys, localized display names and units, and current-state consent bindings across languages. Existing buttons already bind real actions, but English-only short-text handlers do not establish Tamil/Tanglish equivalents.
3. Current submitted conversations are intentionally immutable. Add an explicit new-request flow and a separate merchant-reviewed amendment workflow rather than treating new speech as permission to edit an old snapshot.
4. Demo data needs merchant review. Unknown compatibility, package conversion, tax basis and synthetic stock cannot become production facts.
5. Authenticated imports and scalable media storage/retention are still proposed, not implemented.

No real WhatsApp image carousel was sent. The preview's ten-card limit and ₹0.50 planning assumption must not be mistaken for verified current template eligibility/pricing.
