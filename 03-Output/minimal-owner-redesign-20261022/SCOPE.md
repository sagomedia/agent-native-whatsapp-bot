# ShopBot redesign decisions

Captured from the user's clarification on 22 October 2026. These requirements were approved before implementation; this directory records the implementation and its verification.

- Three order stages: New, Ready for pickup, Completed. The customer has already checked the bill and placed the order before it reaches the owner.
- Owner reviews the order in New. Sending a revised bill is optional and remains within New. Do not add a mandatory approval workflow or mandatory Preparing stage.
- Ready for pickup sends an informational pickup notification. Actual collection closes the order.
- Treat the supplied demo catalog prices as ordinary product prices in the demo UI. Preserve the customer-submitted bill snapshot so later catalog changes do not silently rewrite an existing order.
- Show the customer-seen prices in the owner order. Owner can edit the order's prices, quantities and item selection. Editing an order price should not silently edit the whole catalog.
- Inventory is advisory. Zero, missing or stale recorded quantity must not automatically hide a product, reject a customer's requested quantity, or block order handling. Distinguish unknown stock from a confirmed absence in store.
- Prefer two groups, Items and Needs checking, instead of labeling catalog matches Available. Use small row-level warnings only when relevant.
- Clicking the item identity/photo opens a search picker; quantity and price inputs remain independent. Show the customer's original wording, catalog alternatives, and a Use store item escape hatch. Unlisted store items belong to this order and do not require creating a catalog entry.
- Product search is required, including existing multilingual search behavior.
- Product creation remains one action from image, name, price and optional recorded quantity. AI can suggest other descriptive details. Do not restore a mandatory draft/review/publish sequence.
- Catalog completeness feedback should be contextual and compact. Do not add many permanent buttons or interrupt every product creation with a readiness checklist.
- Keep a small ₹10 advance panel: customer reported payment versus owner checked receipt. No compulsory transaction-reference entry in the proposed UI. Store owner confirmation metadata separately; the ₹10 advance must not mark the entire bill paid.
- Delivery reliability belongs to the platform. Handle retries and diagnostics internally; show a plain actionable message only when the owner needs to know. Do not add sender blocking or expose internal test-mode/blocked-send diagnostics as normal business workflow.

## QR investigation

The configured SMB project path was unavailable. Inspected the related local checkout at /home/gk-pc/whatsapp-bot-finish read-only; correspondence to the running deployment is unverified.

apps/server/src/services/upi-advance.ts already generates a ₹10 UPI URI with tr and tn, renders a QR, and reuses the stored request when reopened. Its existing manual verification function requires a bank reference. The proposed simpler manual confirmation needs a deliberate future backend change; no payment changes were implemented here.

Google documents tr as a unique request reference and tn as a transaction note displayed in the payflow. This does not guarantee that arbitrary merchant references appear in every recipient bank statement or payment-app receipt. Verify the actual merchant VPA with small end-to-end GPay/PhonePe tests before relying on note-based identification. QR generation alone provides no bank settlement callback.

Use a readable order code in the note and a unique payment-request reference. Reopening the same request should reuse its identity; create a distinct attempt only for a genuinely new request. Automatic verification requires supported bank/PSP integration, with its own commercial terms.

Sources:
- https://developers.google.com/pay/india/api/web/create-payment-method
- https://developers.google.com/pay/india/api/android/in-app-payments
- https://support.google.com/pay-offline-merchants/answer/9232302?hl=en-GB
