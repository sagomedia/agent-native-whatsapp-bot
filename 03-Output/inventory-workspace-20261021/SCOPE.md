# Inventory workspace revision

Accepted request: remove the repetitive checklist and use official Zoho Inventory and Odoo documentation to develop a different, information-dense owner interface. Keep the facts required for inventory work visible and make the input boxes and workflow easier to use. Continue the dashboard candidate at 9b7bafe on draft PR #54; issue #52 retains human/device/release acceptance.

Implement a dense inventory table and a compact, tabbed product record. Keep price, physical on-hand, reservations, available stock and visibility visible together. Group core identity and selling facts; give detailed selling policy, stock operations/history, photo evidence and customer-search facts proper sections. Remove the five merchant confirmation checkboxes. A single explicit publication review presents the actual product facts and confirms them together; drafts never certify facts. Keep all backend validation, optimistic versions, photo provenance, unknown-value semantics and stock/payment/consent rules.

Use the existing ShopBot palette and English/Tamil support. Desktop controls may be compact while phone controls retain 44px targets. Preserve all existing owner functionality and advanced fields. No new accounting, warehouses or supplier features are implied by the references. No production deployment or live provider actions.

Research sources:
- https://www.zoho.com/us/inventory/help/items/items-overview.html
- https://www.zoho.com/us/inventory/help/items/item-details.html
- https://www.zoho.com/us/inventory/help/items/item-managing.html
- https://www.odoo.com/documentation/19.0/applications/inventory_and_mrp/inventory/product_management/configure/type.html
- https://www.odoo.com/documentation/19.0/de/developer/reference/user_interface/view_architectures.html
- https://www.odoo.com/documentation/19.0/applications/general/search.html
