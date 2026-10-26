# Compact mobile owner workspace

Implemented locally on `codex/compact-mobile-ux-20261026`, based on verified deployed source `38bab5e` including the mobile image optimization work. The historical SMB checkout is unavailable; this separate local checkout preserves the active photo/audit/redesign sequence that is newer than remote main.

## Behavior

- Orders, Chats, Products and Settings use their own headings without repeated ShopBot branding. A shared compact row style retains visible names, amounts, units and status information.
- List controls and bottom navigation tuck away when scrolling down. A small upward scroll restores search, filters and navigation; the heading returns at the top. Search focus, menus, editors and keyboard navigation keep controls available.
- Left/right swipes switch Orders → Chats → Products and back, without wrapping past the ends. Vertical scrolling, horizontal filter strips, fields, dialogs and browser-edge gestures retain their own interactions. Ghost-click suppression is confined to the swipe endpoint so another button remains usable immediately afterward.
- Filter/stage labels stay on one horizontal row in English and Tamil. The selected option is brought into view. The Tamil dictionary covers the affected daily controls and Settings; customer messages and product names remain unchanged.
- Order and product thumbnails open a full-screen, borderless photo viewer. It requests the existing full optimized image, supports zoom, and closes with Close, Escape or browser/Android Back while restoring focus. Item identification stays a separate action.
- Order items use a full-width identity row and distinct quantity, unit price, line amount and original customer-price information. Stock and original bill/payment behavior are retained.
- Product import, bulk tools, drafts and AI activity remain reachable. Import and advanced editing suppress tab swipes. Existing 10 MB image selection/optimization and variant entry remain intact.
- Chat history and the reply composer remain separate. Viewport resizing now preserves the bottom/reading anchor as well as media resizing, helping when a phone keyboard changes the available height.

## Verification

The production build/typecheck and 4 catalog-cleanup checks passed. The complete integration suite passed **1,001/1,001**, without skips. After the viewport observation change, the focused reading/polling suite passed **10/10**.

- **18** new mobile browser checks cover real Chrome touch gestures, scrolling, menus, photos, edits and all four pages at 320/360/390/430px in English and Tamil.
- **29** existing real-backend browser checks passed with **10** successful writes to an isolated synthetic PostgreSQL schema, including products/photos, shelf counts, item replacement, unlisted items, original prices, revised bills, the order lifecycle and advance confirmation.
- Existing variant, manual-reply latency/recovery and long-chat scrolling browser scenarios passed. The long-chat fixture was updated to supply the current reading-position response and to reflect that jumping to latest intentionally replaces old pages with the latest page. Its order-list selector now points to the new independently scrolling rows container.
- No uncaught browser errors were observed in passing runs. The real backend fixture does not send WhatsApp messages or use live AI/payments.

Evidence is under `evidence/`. Images use synthetic records and are screenshots of implemented code, not generated design mockups. Real phone acceptance, especially Redmi/browser keyboard and system gestures, remains a user check; desktop emulation is not a physical-device test.

## Review and release state

Interactive local review: `http://127.0.0.1:3080/owner` (isolated synthetic data). The preview process is session-local. Production, credentials, owner authentication, live inventory and customer messages were not changed.

The source is committed locally and a recovery bundle is saved with this chat's artifacts. GitHub publication is pending: automatic approval review rejected creation of a tracking issue because the proposed payload contained internal implementation/deployment details and the repository destination was unverified. No workaround or external write was attempted afterward. A branch/PR can be published once the owner approves that concrete destination and action. Future deployment should use the existing off-server build and guarded VPS release process, preserving the latest active release and configuration; it is not performed by a GitHub merge.
