# Product size, purchase count and requested amount

The draft keeps three separate facts: a product's verified pack size or dimensions,
the number of merchant selling units to buy (`quantity`), and the customer's total
requested physical amount (`requestedAmount`). Every correction retains its stable
line ID and original supporting phrase. Changing an amount does not replace the SKU
or its catalog photo.

`set_amount` sets a total; `increment_amount` adds to the current total. Backend
conversion checks actual catalog content, selling-unit verification, quantity steps
and stock. A verified 10m hose sold per whole piece converts 50m total into five
pieces. Five metres requires a cutting check. A single continuous 50m length cannot
be satisfied by five separate 10m pieces. Unverified selling information retains the
photo and requested amount with a specific shop-check reason. No amount correction
submits an order or preserves an old final approval.

An explicit pack count takes precedence over a redundant planner amount: “one 10L
can” keeps count one and pack size 10L. “10L paint” alone still needs a count or
selling-basis clarification. A verified pack constraint is applied separately during
catalog retrieval, so “10 liter paint” can match a `size: 10L` fact even if a repaired
AI plan omitted its search metadata. Brand and other product words are retained;
10kg is never substituted for 10L. Capacity/volume keys also consult catalog size
metadata. Price-zero entries marked `confirm` require a shop price, not a free bill.

Mixed edit-and-bill requests apply the edit first. The response keeps the relevant
photo, names the unresolved reason, and shows an explicitly incomplete subtotal for
the priced, resolved lines. Pure price questions remain read-only. Product approval
always precedes a new quantity/bill review and final text/button submission.

Typed Tamil/Tanglish can update an implicit language preference. A romanized voice
transcript alone cannot switch a saved Tamil reply preference. Explicit spoken
language changes remain supported. On owner resume, a pending incoming greeting
receives one normal continuation reply instead of a separate resume acknowledgement.

Legacy drafts are not rewritten during deployment. A fresh review can recover a
mistaken amount-as-variant line only from a real SKU previously shown for that same
line, then recheck current catalog facts. Owner takeover and old approvals remain
intact until their normal actions occur.

Regression coverage is in `tests/amount-editing.test.ts` and the owner-fulfillment,
visual review, contract, voice, catalog, reservation and channel suites. Saved ASR
replay is distinguished from fresh recognition tests; local demos use a disposable
catalog and never certify live merchant facts.
