# Owner unread indicators and reading position

Owner request: distinguish opened/unopened orders with a small red signal, show unread chat message counts even when the bot replied, and reopen chats where the owner left reading. Retain existing order statuses and reply controls.

Build from deployed carousel source 1ff0022 / evidence 274e73b. Main bb5e509 lacks the deployed baseline; retain PRs 72, 74 and 76 dependencies.

Add authenticated owner-scoped read receipts with an additive migration. An order receipt records the exact attention snapshot that was displayed, so a concurrent new customer update remains unread. Chat read progress advances only for visible messages in the explicitly opened, visible chat; bot replies never clear unread customer messages. Store a separate viewport anchor so scrolling back does not reset read progress. Preserve anchors across navigation and reload, show an unread divider, load history around the saved position and paginate both directions without silently skipping messages. Add red row/navigation badges with accessible labels. Hidden mobile panels and background tabs must not mark records read. Keep commerce state, customer delivery receipts and bot behavior unchanged.

Verify API authorization/store scope, monotonic read cursors/concurrent messages, unread counts, order snapshots, long-history restoration, actual desktop/mobile scrolling and visible badges. Run production build, focused/full integration suite and required catalog cleanup checks. Deploy through the existing backup/rollback path after checks; owner phone/device acceptance stays explicit.

Baseline reconciliation: the VPS moved to `preview-6b3ef5daa8f3`, source `2a700242`, during this work. Imported its exact local source checkpoint and merged it to preserve owner MCP workflows, inventory imports, photo recovery and diagnostics. Existing migrations 47/48 remain intact; unread receipts use migration 49. Re-run validation on this combined source before deployment.
