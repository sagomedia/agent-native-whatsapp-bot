# Temporary shared-password demo verification

Tracking: https://github.com/sagomedia/agent-native-whatsapp-bot/issues/83

The implementation starts at the exact active source 52c52c7935a0a563a0d8b35c12ab11010304dd52, preserving the audit workflow and mobile photo optimization. Scope was recorded before implementation in ec1ce60. Main did not represent the deployed source when work began.

Focused authentication and existing owner tests: 11 passed. Checks cover explicit opt-in configuration, missing/wrong passwords, protected pages/APIs/assets, shop/host scoping, hashed expiring sessions, origin/body guards, logout, password rotation, persistent client/global throttling, rejection of demo cookies in Cloudflare mode and existing owner controls.

Production build/typecheck passed; four Python catalog-cleanup tests passed. HTTPS Chrome checks passed at 320×740, 390×844 and 1280×900. They exercise wrong-password feedback, show/hide, sign-in, retained session after reload, sign-out/reentry rejection and no login-page horizontal overflow. No browser JavaScript errors occurred. Browser fixtures are synthetic; screenshots contain no customer data or live passwords.

A populated PostgreSQL custom dump was actually restored into another disposable database and migrations rerun twice. All 33 tracked tables matched, including catalog, photos, stock ledger, audit findings/receipts/activity/traces, hashed demo sessions and persistent attempt budgets. This is an isolated restoration rehearsal, not a replacement of current VPS data.

The full integration result and actual deployment status are recorded below when complete. Cloudflare management was not yet connected during local verification; no claim that the public email prompt is removed follows from these local checks.

The first full run found a consumed response-stream cancellation error in the expired-authentication UI path (1,006 passed / 1 failed). The response handler now avoids cancelling an already consumed stream, with a targeted regression for returning expired demo sessions to the current owner view. A complete rerun follows the fix. An additional OAuth regression proves the demo session cannot authorize the public MCP endpoint and a genuine grant still lists tools.
