# WhatsApp bill template draft

- Proposed template name `shopbot_order_bill`
- Category **Utility**
- Header format **Document** with the itemized final bill PDF attached
- Body **Here’s your bill from {{1}} for order {{2}}. The final total is {{3}}. Your itemized bill is attached.**

| Variable | Content | Example |
| --- | --- | --- |
| {{1}} | Shop name | Demo Hardware |
| {{2}} | Customer-facing order reference | DEMO-0142 |
| {{3}} | Final total with currency | ₹525.00 |

The attachment contains the saved bill revision and all its item pages. Use the customer’s template language, the agreed recipient, and the order’s confirmed total. Enable outside-window delivery only after Meta approves the applicable template and the customer has agreed to receive the bill. The current release uses open-window WhatsApp delivery and dashboard download and print.

[Meta WhatsApp Business Messaging Policy](https://whatsappbusiness.com/policy/)
