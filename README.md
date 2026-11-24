# ShopBot AI

ShopBot lets customers order from a shop’s inventory over WhatsApp. Customers describe what they need in Tamil, Tanglish or English by text, voice or photo. Gemini interprets the request. PostgreSQL supplies the shop’s actual products, selling units, prices and order history. The customer reviews the list before sending it to the shop. Staff use the owner dashboard to check stock, prepare the order and record pickup.

| Where to run it | What to open | Instructions |
| --- | --- | --- |
| Connected local checkout | [Local owner dashboard](https://shopbot-local.sagoautomation.tech/owner) and the shop’s connected WhatsApp number | [Start and restore the local connection](LOCAL-DEVELOPMENT.md) |
| Existing Google Cloud VPS | [VPS owner dashboard](https://shopbot-preview.sagoautomation.tech/owner) and the shop’s connected WhatsApp number | [Check the service, deploy and recover](deploy/native/README.md) |

Both run the same application with WhatsApp, Gemini and PostgreSQL. The databases and owner sessions are separate. During a connected local session, the shared number’s webhook goes to the local checkout and any valid WhatsApp sender can start a conversation.

From the repository root, install dependencies once with `npm ci`. After [setting up the private connection profiles](LOCAL-DEVELOPMENT.md#prepare-another-computer), run `npm run whatsapp:local`. Wait for `LOCAL_ROUTE_READY` before testing on the authorized phone.

For customer and owner workflows, application structure and the files behind each feature, read the [product guide](docs/PRODUCT.md). For source changes, use the [private repository](https://github.com/sagomedia/agent-native-whatsapp-bot) and the [contribution guide](CONTRIBUTING.md).
