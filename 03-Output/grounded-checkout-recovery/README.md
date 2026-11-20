# Grounded matching and checkout recovery

The local ten-item order reached a ₹2,365 estimate. A product typed in everyday language had no visible choices, and the invoice returned customers to the product list. An earlier voice list failed because one search hint was empty. The earlier successful local order used separate product and send confirmations.

- Use exact aliases from the current store with matching product-name evidence, including items classified under a different inferred family. Keep explicit store, brand, family and specification constraints. A broad family alias alone cannot establish an individual product's identity or missing qualifiers.
- Recover an empty list of optional search keywords from the item's validated search identity or query. Keep the customer's original wording and quantities, reject invalid evidence, and preserve explicit empty SKU selections.
- Name the next blocking item on the estimate. For a request that has no matching product and cannot be sent incomplete, give the customer its edit action and the shop-help action. If shop-check requests are enabled, the final bill explains what the shop will check and keeps the explicit send action.
- Save one request with all lines and the known subtotal when the customer sends a shop-check bill. The dashboard uses the existing New orders filter and marks unresolved lines for review. The local test session can enable this existing policy for the allowed test recipient.
- The real saved draft still has two units requested. Replaying its saved lookup against the current SQL catalog returns three eligible product photos. Regression fixtures cover a different inventory type, a wrong family assignment, an accessory, a late item with empty search hints, and the final request's dashboard status.
