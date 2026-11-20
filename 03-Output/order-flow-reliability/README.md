# Order flow reliability

Preserve the visual shop counter. A product request should lead to current inventory photos, names, prices, and a scoped choice. Broad searches can narrow through relevant catalog photos and attributes. Counts stay attached to their items through swipe, choice, change, and checkout. Browsing the store is a separate action.

1. Route estimate, checkout, and submission through the same readiness decision. If a line blocks checkout, name it and give the customer a concrete action. Product approval stays separate from final consent.
2. Fix source binding of fractional dimensions and prevent a failed named edit from widening to unrelated rows. Verify corrections, removal, add, and read-only views against current draft IDs.
3. Carry normalized item identity and evidenced brand, count, pack, and dimensions into SQL before ranking. Attribute and taxonomy guesses can help rank. Preserve real candidate IDs and recheck them under the same constraints. Handle an unclear request separately from a missing catalog entry.
4. Resume interrupted voice work from its validated evidence. Keep independent requests visible while preserving the atomicity of linked corrections.
5. Replay the blocked subtotal, fractional-pipe removal, ¾-inch pipe at 10 feet, brand-versus-length confusion, and multi-item voice cases. Verify a different catalog, genuine photo carousels, stale callbacks, and final consent. Keep real provider and phone checks separate from mocked regressions.

This work starts from review commit `622f075`. The local test history is evidence for the failures. Raw customer data and recordings belong outside Git.

## Implementation notes

- An estimate keeps the known subtotal and routes the next action through the same draft facts used for checkout. With partial review disabled, a blocking item is named and gets its own edit and shop-help buttons. Seeing an estimate or approving a product photo does not submit an order.
- Named removals use current item IDs, identities and dimensions. Saved group choices also recheck the actual named scope when used.
- Search, SQL candidate observation, selection and review pass physical dimensions alongside the product words. A stored nominal size can include its equivalent label. A selected SKU that changes dimensions is rechecked before review. Compact uppercase identifiers such as 3M retain their spelling.
- A failed catalog check can retry a saved voice interpretation for the same recording, customer and draft version. It reruns catalog validation. Independent additions can keep checked photos and counts while flagging an unfinished search separately. Linked changes stay together.
- Replaying the 343-product snapshot returned Astral PVC Pipe 3/4 inch 10ft and excluded the 20 mm conduit. The 3M insulation tape request had no exact listing in that snapshot. A broader pipe request produced a native two-photo carousel payload with a selection action bound to each SKU.
- The network-free replay exercises SQL and the WhatsApp payload renderer. Viewing and tapping the results on an actual WhatsApp handset still requires the review release to be connected.
