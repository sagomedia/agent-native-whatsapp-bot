# ShopBot test integration privacy policy — owner-review draft

Prepared 5 October 2026 for Sago Automation's KSMC RETAIL WhatsApp test integration.

This is a controlled text-message test using a Meta test sender, approved test recipients and a demo product catalog. It is not a payment or fulfillment service. AI interpretation is currently disabled.

The integration processes the recipient's WhatsApp number, message text or message type, message identifiers, timestamps and reply-delivery status. Numbers route replies; dashboard conversation identifiers do not expose the full number. Unsupported media is not downloaded by this version.

Records support receipt/reply testing, shopping drafts, owner review of test requests, failure diagnosis and duplicate prevention. Only the configured owner can access the private dashboard. Test request decisions do not currently send customer notifications.

Messages pass through Meta's WhatsApp Business Platform. Google Cloud hosts the application/database, and Cloudflare handles inbound HTTPS. Those providers process information under their own policies. This version does not send message contents to an AI provider and does not sell message data.

Test records remain in the server database until the operator deletes them; there is no automatic retention deadline. Private deployment backups can retain copies after active-database deletion until backup copies are removed. Records/deletion requests go to the operator below and are checked against the relevant WhatsApp identity before changing records.

Proposed public contact: **Sago Automation — admin.sagomedia@gmail.com**.

Do not send passwords, payment-card information or other sensitive information to the test bot.

Publication is pending owner review, including approval of the contact address and the actual storage/deletion practices described here. This draft does not authorize publishing the Meta app or accepting its terms.
