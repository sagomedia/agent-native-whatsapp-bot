# Owner inner workflow review

Accepted request: check and improve the individual screens within every owner process, preserving the useful information and reducing the clicks and teaching needed. The user also asked whether the preceding inventory revision was deployed: it was not; it is local and in draft PR #57. That question does not authorize a VPS deployment.

Baseline: `dd1f425`, following consolidated main `2d31891`. Continue the unfinished owner usability change on `codex/inventory-workspace-20261021` / PR #57. Issue #52 retains staff, device, provider and release acceptance.

Review coverage:

| Work area | Inner screens and transitions |
| --- | --- |
| Today | Work shortcuts, exceptions, diagnostic expansion, paused and unavailable states |
| Orders | Quote editing, matching and photos; validation; saved drafts; customer changes; advance/refund; cancellation; acceptance and pickup; stock repair and return |
| Messages | Worklist, takeover, compose/send recovery, transcript paging, attachments, interpretation evidence and related orders |
| Products | Five record sections; publication; quick price and stock; inline changes; CSV preview/apply/receipt; drafts, source conflicts and import progress |
| Settings | Connection, pause, usage/cost details, monthly analytics, activity and errors |
| Message review | Stage/language filters, preview details, empty and unavailable states |

Use the current shop-specific visual system: white surfaces, pale green background, dark green text, teal actions; existing Arial/Tamil fonts. Keep inventory and order facts aligned and compact. Retain advanced controls in clearly named sections. Do not introduce tours, mandatory checklists, decorative summary cards or controls for unsupported business features.

Prioritize actual task and recovery defects over cosmetic changes. Verify the changed transitions with synthetic local APIs and browser checks, including keyboard and narrow English/Tamil layouts. Preserve unknown stock/payment/delivery truth, idempotent retries, reservations, source evidence, drafts and server validation. Record findings, fixes, evidence and remaining limits before pushing the final checkpoint and checking hosted CI.

VPS release is a separate step. This pass prepares reviewable source and local evidence; no live customer sends, payments or provider evaluation are part of the UI review.
