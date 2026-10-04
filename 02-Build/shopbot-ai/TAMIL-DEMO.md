# தமிழ் ShopBot டெமோ — 4 October 2026

Open http://localhost:3017/native-test and choose **New chat**.

The simulator controls stay in English. Bot replies and product cards have a separate language preference. New conversations start in Tamil. Tamil, Tanglish and English input are understood without automatically changing the reply language. Choose **Tanglish** in the **Bot replies** selector or type “Tanglish la pesu” for Tamil in Latin letters. English is available only after an explicit selection/request such as “change to English”. Type “தமிழில் பேசுங்கள்” to return to Tamil. A standalone spoken language request can change the preference after its actual transcript is validated; audio cannot approve products or submit an order.

## Demo sequence

1. Say **வணக்கம்**. The greeting uses no AI call.
2. Ask **ரெண்டு கட்டிங் பிளேடு வேண்டும். என்ன வகைகள் இருக்கு?**. Open descriptions use one guarded free inference. The store search supplies actual pictures and prices.
3. Check the photos, brand, size and sales unit. Choose the correct item. An uncertain image/name is a suggestion until you explicitly choose it.
4. Reply **ரெண்டு பீஸ்** or **2 pieces** to a quantity question. Known quantity answers use no AI; incompatible units require clarification.
5. Review **என் பட்டியலைப் பார்**. Confirm **கடைக்கு அனுப்பு** only when the current list and total are correct. This submits a request awaiting shop approval; it does not mark stock reserved, payment paid or collection ready.
6. **Upload image** → preview → optional Tamil/Tanglish caption → **பொருத்தமான பொருட்களைத் தேடு**. Sending shares the photo with Gemini. Cancel uses no AI. Matches remain read-only until selected.
7. **Record voice** → record up to 30 seconds → preview → send or cancel. Check the resulting product photos. Previous submitted requests need a new chat for new items.

## Implementation

The locale is saved in `conversations.reply_language`, separately from the business version. Switching language keeps draft quantities, question/review IDs, expiry and final-consent bindings. Replaying the same event does not repeat the change/reply. New native sessions explicitly start `ta`; migration 14 sets previous local native sessions to Tamil once, while the separate English mock/regression channel keeps its compatibility default. Real WhatsApp ingress must also explicitly initialize Tamil.

Backend templates own prices, units, totals, product checks and status copy in Tamil, Tanglish and English. The model gets the chosen language for its short clarifying questions. Questions in an unexpected language or with unsupported commerce claims fall back to a backend question. Optional provider nulls are treated as absent only for named optional fields; required fields and unknown actions remain strict.

Catalog `localNames.ta` and `localNames.ta-Latn` are presentation metadata, stored in SQL `local_names`; canonical SKU/name/specifications and price calculations remain intact. Demo translations are seeded once into empty translation fields and add search aliases without overwriting merchant edits. Localized family labels narrow the same authoritative IDs. Product identity includes translation metadata so edited product presentation requires a new check.

These are proposed Tamil/Tanglish wordings, ready for owner review of local terminology. All 30 demo products remain unverified production data. Proper brand names and technical identifiers such as PVC, ISI, M-Seal and SKU are intentionally preserved.

## Limits

One outbound reply per turn, at most ten cards and three product-check groups; no automatic image fanout. Three Gemini calls/minute, 15-second spacing, 100/day; paid inference stays disabled. Historical messages retain the language in which they were sent. Technical source code and administrator diagnostics remain developer-facing.

Google Cloud and real WhatsApp delivery are subsequent milestones. The current `/api/native-test` endpoints intentionally reject public hosts. Follow workspace `HANDOVER.md` before hosting.


## Intent discovery correction

Use English, Tamil or Tanglish input without requiring the catalog name. A vague cutting request can show three to six real options in one reply and ask what will be cut. A specific pipe-cutter request shows H19; fewer than six valid options is expected. Explicit purchase quantities are retained while exploring. The planner compares current database facts; deterministic retrieval rechecks its keywords, proposed families and SKU ranking. Product suitability is tentative until technical metadata is merchant-verified. See INTENT-DISCOVERY.md and 03-Output/016-intent-discovery-verification.md.
