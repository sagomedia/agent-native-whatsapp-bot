# Test product matching and bulk improvement

These prompts are for the owner to run after deploying this version. The WhatsApp examples create a shopping list in the test conversation. Do not tap the final send-order button unless you intend to place an actual order. If you already have an active list, start a new test list only when you are happy to replace it.

## WhatsApp: customer product identification

Send each prompt separately. Use both typed text and your own voice; compare what was spoken with what the bot understood.

1. **Existing Tamil alias and size**
   > எனக்கு 12 இன்ச் ரச மட்டம் ஒன்னு வேணும்.

   Expect the actual 12-inch spirit-level choices with photos and prices when multiple listings match. Choose a photo; the quantity should remain one. No order is submitted by choosing a product.

2. **Meaning from store context**
   > நள்ளி ஒன்னு வேணும். தண்ணி குழாய்ல போடுறது.

   Check whether the bot searches a relevant water-tap type, shows real catalog photos, or asks one useful clarification if the meaning remains ambiguous. It must not assert an unrelated item as certain. Tamil pronunciation may differ from the spelling here.

3. **Product use distinguishes solvent types**
   > PVC பைப் ஒட்டுற சால்வென்ட் ஒன்னு வேணும்.

   Relevant choices should be pipe solvent/cement. Paint thinner must not be silently substituted. If the bot cannot identify the request, note the exact wording and the response.

4. **Broad solvent with visual clarification**
   > சால்வென்ட் வேணும்.

   Expect visual product-type choices or a short use question. If categories are displayed, category photos are examples; selecting one should narrow the search, not add that example automatically.

5. **Similar-sounding words**
   > மரம் செதுக்க ஒரு உளி வேணும்.

   Relevant chisel photos should be offered when supported. Also try an unclear voice message: the bot should ask if uncertain instead of silently changing a similar-sounding word to a different item.

6. **Unsupported size / missing product**
   > 24 இன்ச் spirit level ஒன்னு இருக்கா?

   If the catalog has no supported 24-inch item, the bot should retain the request or ask for useful details; it must not present a 12-inch product as the requested 24-inch item. Catalog contents can change, so verify the actual listing.

7. **Multiple items and correction**
   > ஒரு ரச மட்டம், ரெண்டு டெப்லான் டேப், ஒரு PVC பைப் பசை வேணும்.
   > டேப் ரெண்டு இல்ல, மூணு மாத்துங்க.

   Check that the bot retains all three items, changes only the tape count, uses visual choices, and does not send the order without final consent. Count customer turns; fewer than 15 is a goal, not a hard cutoff.

Record the customer words, time, shown photos, correction and resulting message. A transcription failure, wrong product, missing catalog entry, and delivery failure are different problems.

## ChatGPT: review and apply together

After the new tool is deployed, open the connected inventory app in ChatGPT and use **Refresh tools** once if `catalog_audit_batch_preview` is not listed. The app must have owner-read and catalog publication permissions. The ChatGPT client may display its own permission prompt for a write. The following review is read-only until you explicitly authorize the saved changes:

> Review our store's customer product-matching problems from the last 72 hours. Use the store context and read every page of retained audit evidence. Investigate the original Tamil, Tanglish and English wording against real products and their photos. Group repeated requests together. Distinguish likely aliases, uncertain meanings, voice transcription errors, missing products and bot flow bugs. Save evidence-backed findings, correct your own proposals when the evidence conflicts, and show me one short grouped review. Use the bulk preview for the proposed findings. List the exact products and terms that are ready, and show blocked or unclear cases separately. Do not change inventory or send customer messages yet.

If the review has no suitable findings, it should say so instead of creating examples or fabricating evidence. Save calls may need multiple groups of 25; the review and final owner decision can still be presented together.

After reviewing the listed products and terms, explicitly authorize the selected findings:

> Apply all the ready alias and keyword changes from the review that I have approved. Leave the uncertain, blocked, voice-error and missing-product findings unchanged. Use the batch preview, apply up to 200 products at a time with stable operation IDs, and report successful products, skipped findings and any conflicts. Keep existing photos, prices, quantities and selling units unchanged. If a product has changed, reload and show the conflict rather than claiming success.

For the first live trial, you can limit that instruction to two or three reviewed products. Then search the new terms through ChatGPT and in a fresh WhatsApp test. If a response is lost, ask the agent to retry the identical operation with the same operation ID; it should return the existing receipt, not duplicate the change. Undo only after reviewing the recorded events and current product versions.

## Evidence limits

An MCP client can analyze only retained conversations and the catalog it can access. A bulk preview does not approve changes, and a model's suggested mapping is not independent proof. The WhatsApp model may still misunderstand real audio or local terms; run the voice examples before claiming those cases are fixed. Aliases do not repair transcription failures or missing commercial facts.
