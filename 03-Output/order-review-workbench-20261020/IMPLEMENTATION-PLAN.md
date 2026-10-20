# Approved Orders workbench redesign

The owner approved implementation of the supplied ShopBot order review and quote mockup and the five review refinements on 20 October 2026.

## Scope

Build a searchable order queue, editable product table, stage indicator, and quote summary using existing dashboard tokens: white #FFFFFF, page #F4F6F8, text #20252B, muted #64748B, action blue #2563EB, borders #D9E0E8. Keep the current dashboard typeface and navigation. Product rows and unresolved checks carry the hierarchy; avoid decorative UI.

Use the deployed visual-shopping branch as the base because main predates the current production application. This is a focused follow-on to PR #49, with its customer carousel behavior preserved.

- Inline catalog matching, original requested wording, explicit manual item confirmation, and actionable row checks.
- Durable server-side quote drafts with optimistic version checks, clear save/error state, and protection from customer amendments or concurrent owner edits.
- Separate customer quote approval, merchant stock acceptance, advance verification, and packing/collection states. Preserve checkout lists as not-yet-submitted orders.
- Wide desktop queue/editor/summary; compact laptop summary and mobile order/detail navigation with accessible controls and visible focus.
- Original order details and conversation access, validation, empty/loading/error states, and useful incomplete quote totals.

## Implementation and verification

Extend authenticated owner APIs and quote validation to support saved drafts and deliberate catalog matches without changing customer consent or stock reservations. Use a new database migration. Build the responsive owner workbench and retain advance/refund, amendment, fulfillment, and cancellation actions. Add integration tests for draft persistence/concurrency/isolation and catalog-match consent/stock behavior, plus browser checks for the new workflow and representative screen sizes. Run the required production build, integration suite and Python checks; publish the change with evidence. Deploy after verification using the established release process and preservation checks, as authorized in the ongoing implementation request. Keep real-device acceptance open for the owner's review.
