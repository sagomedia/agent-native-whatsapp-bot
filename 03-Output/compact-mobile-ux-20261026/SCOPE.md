# Accepted mobile UX scope

Implement the approved compact teal/white, borderless design. Use Orders, Chats, Products and Settings headings without repeated ShopBot labels. Hide list controls on downward scrolling, reveal on a small upward movement, and retain focused controls and chat/save actions. Add deliberate horizontal swipes between Orders, Chats and Products; preserve vertical and filter-strip scrolling, browser edge gestures, dialogs and editing. Keep ordinary buttons and keyboard navigation as alternatives.

Make filter/stage/category strips horizontally scrollable without text wrapping. Fix Tamil layout and translate the affected everyday controls while preserving customer/catalog content. Use small recognizable icons with usable touch targets. Open order/product photographs in a full-screen, closable, zoomable viewer; keep product identification and editing as separate actions.

Preserve original customer price snapshots, three order stages, optional revised bills, advance verification, variant-specific inventory, chat drafts/takeover/delivery states/history, AI activity and image optimization. Start from the latest verified production source including the 10 MB mobile photo changes (38bab5e / tested application source 52c52c7), since current remote main predates those deployed changes. No authentication, billing, business-policy or schema changes are part of this scope.

Verify with a production build, focused gesture/browser checks at narrow widths in English/Tamil, meaningful order/product/chat regressions and required repository checks. Publish a reviewable branch/PR; device acceptance and production activation are separate from local implementation.
