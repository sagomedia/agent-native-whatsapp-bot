# ShopBot coding-agent handoff — 27 October 2026

Read DEVICE-SETUP.md for the verified recovery path and local run commands; historical README deployment claims may be stale. This checkout is the recovered application and full source history. The original SMB workspace may be unavailable. Another chat has worked on shared copies, so avoid replacing shared source from an older snapshot.

## Product and architecture

This is a Tamil/Tanglish visual retail ordering system for potentially 3,000 products, not a text FAQ bot. Prefer real-photo native carousels (2–10 cards), actual catalog names, rupee prices, visual category/brand narrowing and the existing welcome audio. One genuine option uses a single image; never invent filler images. Generated instruction cards are deterministic local images, not paid image generation. Preserve all requested lines and counts while checking one item at a time. See WORKING-PREFERENCES.md for the owner's development model routing (Sol primary, Terra supporting) and UX/cost requirements.

Main app: 02-Build/shopbot-ai. TypeScript/Fastify server, React/Vite dashboard, PostgreSQL; business services own catalog facts, identity, version checks, idempotency, order submission and owner controls. AI proposes evidence-backed typed operations. Button actions reuse trusted state without extra inference. Explicit product approval is distinct from final order submission and owner acceptance. Missing quantities/prices remain unknown; partial requests preserve unpriced/unidentified lines for shop checking.

## Recent work and evidence

- 7b97c428: restored carousel-first narrowing, checklist/progress cards, 3,000-product bounded retrieval and ten-product choices.
- 73f4df82: exact spirit-level alias found initially but disappeared when its returned owner-other family plan conflicted with inferred taxonomy. Preserve validated exact identity; keep partial preview and final confirmation consistent. Explain rejected submissions rather than silently repeating cart.
- 38e410d3: material-only door-latch correction had incorrectly selected a screw row and proposed aluminium tap. Preserve active product noun/dimensions/count, recognize named follow-up outside a bad earlier candidate set, retain current callback guards. Coordinated Tamil clamp removal now accepts பண்ணிருங்க and யும்; negated removal is blocked. All 1,051 tests and VPS read-only probes passed at that deployment.
- Current follow-up addresses ordinary repeated greetings being suppressed and then handed to owner. Tests retain repetition protection for non-social text and the 30-message burst guard. See current Git commit/test logs and accompanying transfer manifest for final verification.

The affected customer cart from the earlier wrong edit was NOT auto-repaired or submitted: it needs a fresh owner/customer review to restore the screw box and confirm the latch. Current catalog searches had no exact aluminium door latch/stainless tap match; do not invent products or commercial details to fill these gaps.

## Operations

At last verified deployment before this follow-up: VM sago-counter-ksmc, Google Compute project hermes-mcp-test, zone us-central1-a; app service shopbot-vps; active code via /opt/shopbot-vps/current; private env /etc/shopbot-vps.env; media /var/lib/shopbot-vps/media; database shopbot_vps_preview. Public MCP https://demo.sagoautomation.tech/mcp. Use owner_store MCP plus the running service/release manifest to identify the live code; an old source checkout is not deployment proof. Never compile on this small VPS: prior compilation exhausted swap. Build/test/package on a capable local device, preserve a database backup, guard against concurrent activation, verify readiness/auth/content and product/photo digests. No changes to live customer records or messages are implied by reproducing test cases.

A handoff/owner-mode chat intentionally holds assistant replies. Return it to assistant only through an authorized current-revision owner action; do not replay held inbound messages automatically. Repeated greetings caused the recent false handoff, not an API outage. Expired old WhatsApp buttons are a separate version/expiry condition and should lead to a fresh review.

GitHub PR #87 is an older snapshot and does not include the latest local repair commits. An optional upload of newer source was blocked by automatic approval review due to unestablished export authorization; publication was left pending. The portable source bundle is the current recovery source. Do not claim all deployed code is on main or overwrite the GitHub snapshot ancestry. Do not merge/delete branches or copy private production secrets merely to make setup easier.
