# ShopBot dashboard usability candidate

Implemented locally on 21 October 2026. [Scope and baseline](SCOPE.md) · [Implementation and remaining acceptance](IMPLEMENTATION.md) · [Verification record](VERIFICATION.json).

The dashboard keeps the existing commerce workflow and brings everyday tasks closer: Today, Orders, Messages and Products, with Settings and message examples still available. A measured routine price change takes **2 clicks instead of 4**, excluding typing, from an already visible inventory row. This is one measured task, not a claim that every workflow is twice as fast.

[Local synthetic preview](http://127.0.0.1:3043/owner?view=overview) runs only while its local process remains active. It uses an isolated temporary database schema and no WhatsApp, inference or payment connection. Normal production authentication is unchanged.

Build/typecheck, 19 focused owner regressions, four Python catalog checks, synthetic browser acceptance and actual local API browser checks pass. Full regression: **838/840 pass**. The same two customer-conversation failures reproduce on the untouched baseline; tracked in [issue #53](https://github.com/sagomedia/agent-native-whatsapp-bot/issues/53).

This is a review candidate. It is not deployed. Intended staff, physical phone keyboard, screen reader, Tamil copy review and older-device/network acceptance remain open under [issue #52](https://github.com/sagomedia/agent-native-whatsapp-bot/issues/52).

## Screens and interaction evidence

- [Today, desktop](evidence/local-preview/overview-1440.png)
- [Order sheet, phone](evidence/orders/orders-390.png)
- [Messages, phone](evidence/local-preview/conversations-390.png)
- [Inline price/count cards, phone](evidence/tasks/inline-grid-mobile.png)
- [Stock result preview](evidence/tasks/receive-stock.png)
- [Owner Tamil controls](evidence/tasks/tamil-mobile.png)
- [Measured clicks and dashboard task results](evidence/tasks/results.json)
- [Real local database/API results](evidence/local-preview/results.json)

All saved evidence uses synthetic fixtures or public demo catalog data. Personal project-context files remain local and are excluded from this publication.
