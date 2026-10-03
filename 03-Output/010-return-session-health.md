# Return-session health check — 3 October 2026

The local app and PostgreSQL containers were stopped and the SMB project share was disconnected. Reconnected the existing share and started the existing Compose services without rebuilding, resetting data, or changing configuration. Both containers report healthy; /health/ready returns ready.

Synthetic HTTP checks used the same signed-session API as /native-test (no interactive browser automation was available in this session):

- Test page served successfully.
- Greeting: conversational reply, zero Gemini attempts.
- Two PTFE tape rolls: verified ₹40 quote; empty draft, zero Gemini attempts.
- Job-based request to cut PVC: one successful real Gemini attempt; H19 PVC cutter and H16 hacksaw blade choices, question about pipe diameter. Draft remained empty.
- Product image returned successfully.
- Check again: remembered catalog choices, no additional Gemini attempt.

Four outbound envelopes, one Gemini attempt, no submitted request or WhatsApp delivery in this smoke test. Existing free-only configuration retained. The original mock demo remains version 6, five draft lines and one earlier submitted request. No full integration suite rerun was needed because application code was unchanged.

Open http://localhost:3017/native-test, refresh and start New chat. Restart rotates the signed local-session secret; old conversation rows remain in PostgreSQL.
