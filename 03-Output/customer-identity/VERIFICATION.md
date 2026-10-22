# Customer identity verification

Issue: [#63](https://github.com/sagomedia/agent-native-whatsapp-bot/issues/63)

- Typecheck and production build passed on the feature branch and the combined VPS release.
- Full PostgreSQL regression run completed 852 tests: 851 passed; the old v26 reconstruction fixture initially retained the newly added profile columns. The fixture was corrected and its entire 12-test file passed when rerun, on both branches. The hosted full suite must pass before merging.
- The combined VPS release passed 26 focused webhook, owner API, pagination, voice-duration and dashboard tests, plus the corrected 12-test migration rehearsal.
- Four catalog preparation tests passed on both branches.
- Browser checks passed for inbox, selected conversation, selected order and overview at 1440, 390 and 320 pixels, on both the main-based feature and preserved VPS dashboard. Names up to 200 characters wrapped without page overflow; no browser exceptions occurred.
- Synthetic signed-webhook fixtures check sender matching, Unicode names, malformed/absent profiles, stale timestamps, duplicate events, signature rejection and approved recipients. Historical migration, phone fallback, names/phone search across pages, order identity outside the inbox and owner store isolation are covered.

The deployment candidate starts from VPS source `17175d8191a1d81ff462cd2e6747037d2190b7a7`, retaining the newer owner layout and the 90-second voice migration (41). Customer profiles use migration 42. No dependency or environment changes are needed. Deployment checks retain product/store/photo hashes, existing carts and inference budget limits, then verify the owner API in a read-only database session. No customer messages are sent by verification.

Existing WhatsApp conversations already contain their recipient phone. A profile name is available only after the next verified incoming message includes that contact name; no historical names are invented. Real-device confirmation of the next incoming profile remains tracked in #63.
