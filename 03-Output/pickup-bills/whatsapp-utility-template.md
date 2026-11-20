# WhatsApp purchase invoice template draft

- Proposed template name `shopbot_purchase_invoice`
- Category **Utility**
- Header format **Document** with the itemized purchase invoice PDF attached
- Body **Here’s your invoice from {{1}} for order {{2}}. The total is {{3}}. Your itemized invoice is attached.**

| Variable | Content | Example |
| --- | --- | --- |
| {{1}} | Shop name | Demo Hardware |
| {{2}} | Customer-facing order reference | DEMO-0142 |
| {{3}} | Final total with currency | ₹525.00 |

The attachment contains the saved bill revision and all its item pages. Use the customer’s template language, the agreed recipient, and the order’s confirmed total. Enable outside-window delivery only after Meta approves the applicable template and the customer has agreed to receive the bill. The current release sends the invoice after collection when the WhatsApp reply window is open. The dashboard offers the PDF for downloading and printing.

[Meta WhatsApp Business Messaging Policy](https://whatsappbusiness.com/policy/)
