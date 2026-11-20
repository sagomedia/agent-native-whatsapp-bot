# Visible WhatsApp bill

Keep the photo-first review and make the next action visible with the first card of the last carousel. For one product, put the action beneath its photo. The first message tells customers they can send a message or voice note to add, remove or change items. The bill repeats the cue beside the final send action.

- Use the existing shop-branded instruction image for the last carousel. Keep real photographs on the product cards. Group cards in order and reserve a slot for the bill without adding another WhatsApp message.
- Keep the item change button and any required product choice. When individual product choices require a second button across the carousel, use the read-only estimate action in the extra slot.
- For fully identified products, tapping **Show bill** after checking the photos opens a review through the existing product-approval route. If something still needs a shop check, show an estimate and keep the store's current rules for sending incomplete orders.
- Text and voice can update an open invoice. Count-only changes to the same approved catalog identities get a fresh bill. New or changed products get fresh photos. Every submitted order uses the latest delivered invoice and its separate **Send to store** action.

The GOV.UK check-answers pattern recommends placing edits beside the information being checked and labeling the final submit action with its consequence. WhatsApp's fixed card layouts are reflected in the channel renderer, so the main action belongs on the visible guide card where it uses space efficiently. [GOV.UK check answers](https://design-system.service.gov.uk/patterns/check-answers/) · [Sinch WhatsApp carousel format](https://developers.sinch.com/docs/conversation/message-types/carousel-message)

Regression cases include a 12-item list with one catalog miss, an 11-item list after removal, mixed button counts, 19-item pagination, text and voice corrections after the invoice, stale send buttons, and a single final order request for the corrected list.
