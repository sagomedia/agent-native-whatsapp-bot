# Rupee usage display and removal of calendar shutdown

Owner request: rely on the configured Google spending control, avoid arbitrary calendar cutoffs, show costs in rupees and deploy the change to the existing VPS. Current scope retains existing local spending amounts, usage ledgers, admission/token limits and unknown-cost holds. No Google budget, key or billing setting is changed.

Baseline: source 52c52c7935a0a563a0d8b35c12ab11010304dd52 / active preview-2a58e8b0d292, plus documentation-only checkpoint 38bab5e. The original chat worktree predates that deployed code, so implementation is isolated in /tmp/shopbot-rupee-pricing-20261026 to preserve newer features and unrelated work.

The rate validity date becomes advisory: valid pricing and token bounds continue to admit calls after the review date. Malformed pricing still blocks calls; monetary allowances and reservations remain enforced. No monthly renewal/deadline shutdown is added.

Both dashboard implementations display AI and supported USD/INR messaging costs as rupee estimates. Currency conversion uses integer arithmetic; source USD ledger values are retained. The initial ₹95 per US dollar is a disclosed planning estimate, editable with Update rupee estimate and saved only in that browser. Direct INR charges are never converted again. Unknown/unsupported currencies stay unavailable; small nonzero values show <₹0.01 with detailed precision available. View Google spending and cap links to AI Studio; application estimates are explicitly not the provider balance/cap/invoice.

Google documents about ten minutes of possible project-cap latency: https://ai.google.dev/gemini-api/docs/billing#project-spend-caps . A Cloud Billing alerts-only budget is different: https://docs.cloud.google.com/billing/docs/how-to/budgets . No account configuration was assumed verified from the user's description.

All 1,002 PostgreSQL integration tests pass (260.2 seconds), with no failures/skips/cancellations; models are mocked. Deployment evidence will be added after activation. No customer messages or paid model calls are needed for this change.

Phone (390 px) and desktop (1440 px) checks of the actual production build passed using synthetic snapshots: USD amounts converted, native INR preserved, no dollar amount shown, user conversion retained after reload, unsettled reservations distinct, no horizontal overflow and no JavaScript errors. See browser-checks.json and usage screenshots. Typecheck/production build and all four catalog cleanup checks pass.
