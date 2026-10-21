# Owner interface design revision

Accepted request, 21 October 2026: improve the design and usability of every part of the owner interface because it still feels difficult to use. Continue the approved dashboard candidate at `0f591b6` on the existing branch and PR #54; issue #52 retains release acceptance.

Use frontend-design and interface guidelines to revise navigation, visual hierarchy, density, typography, task controls and phone layouts across Today, Orders, Messages, Products/full editor/CSV, Settings and Message review. Preserve all verified functions, information, durable drafts, retry identity, customer consent, stock and payment rules. No production deployment or live provider actions.

## Design direction

- White work surfaces on a restrained grey-green background, ink text and a deep teal action color. Amber identifies facts needing a shop check, green indicates prepared/accepted state, and red is reserved for errors/destructive actions.
- Arial plus the bundled Tamil font keeps forms familiar and supports the intended operators. Use a clear 26/19/16/15/14/12-pixel hierarchy; supporting metadata must not replace readable task information.
- Desktop: a fixed 208-pixel navigation rail and a flexible work area. Phone: a compact header and four persistent daily navigation items. Use an explicit order-stage selector on phones rather than requiring discovery of horizontally hidden tabs.
- Today should show real counter work near the top, rather than a giant count. Product actions should fit together on a phone. Quote inputs, read-only facts, supporting notes and primary actions must look different from each other.
- Keep the established one-sheet quote and internal scrolling. Improve density by removing repeated framing and inconsistent spacing, not by deleting the facts needed to complete work.

Before/after screenshots, responsive browser checks and functional regression evidence belong in this folder. Human/staff and physical-device acceptance remain distinct from automated verification.
