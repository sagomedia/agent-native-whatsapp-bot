# Catalog mind map and voice-driven discovery

Completed implementation, 3 October 2026. All original requirements verified; see workspace report 012.

Requirements:
- Store identity/type → departments → product families → real brand/specification facets, generic across stores.
- SQL-indexed deterministic retrieval that scales beyond a full-catalog model prompt.
- AI extracts compact search keywords from text or a recorded voice note; trusted tools retrieve and rank real products.
- Broad requests ask informative category/brand/specification questions with two or three meaningful real photo suggestions where available.
- Empty exact search does not claim shop unavailability; keep the request and clearly label relevant alternatives or ask about the job. Never invent unrelated products to fill a photo count.
- Actual names, prices, images, units, combinations and submission consent remain backend-owned.
- Preserve multiple requested lines, image confirmation, bounded one-message replies, scoped/stale-safe refinements, and free-only quotas.
- Implement browser microphone → bounded recorded-audio ingress → interpretation/search → visual verification through the reusable backend, without customer profiling.
- Local Git baseline, feature branch/checkpoints, clean final worktree and portable rollback/export instructions. GitHub push is a future action, not a current remote-publication request.

Baseline checkpoint: checkpoint/visual-confirmation (7dd651b). Git metadata is on local disk because SMB does not support chmod. Current source worktree remains the project share.

Completion evidence will include generic two-store tests, a large catalog fixture, refinement and no-hallucination/consent cases, text and recorded-audio adapter checks, actual free-tier live text/audio smoke tests, rendered desktop/mobile UI, and Git/rollback verification.

Verification: 82 passing regression tests; generic 10,000-product second store; final real free-tier text + 7.2-second browser voice check; two checked products and separate ₹1,185 review; no order submission. Git baseline/feature history and portable bundle preserve rollback. Actual WhatsApp delivery remains a separate channel milestone.
