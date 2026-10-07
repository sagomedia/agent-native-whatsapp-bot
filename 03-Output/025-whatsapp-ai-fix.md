# WhatsApp text AI repair

The WhatsApp channel always constructed MockInterpreter. Its owner store had six starter products, and delivered/read replies were omitted from conversation history. These explain the repeated old query and missing hardware suggestions.

The channel now accepts the free-only Gemini adapter under WHATSAPP_AI_ENABLED, with paid inference disabled and zero paid budget. Delivered/read/accepted replies remain available as context. Displayed product codes are validated against current conversation options before selection. The synthetic hardware import is additive; existing messages and requests are preserved. This is demo catalog data, not verified merchant inventory.

The dashboard and public policy describe Gemini text processing. WhatsApp image and voice processing remain unconnected. Existing recipient allowlisting, webhook signatures, dashboard access, and send controls remain in place.

Validation: 116 integration tests passed; production build passed. Regression coverage includes scoped catalog import, delivered history, free billing state, and selecting a displayed code without another inference call. Deployment evidence follows after activation.

## Activation evidence — 5 October 2026

Deployed `preview-4af04b72324d` from commit `745dede`; archive SHA-256 `806e2baa0ffd845ff2a806a31eb97dfb8d5e03ddbc8721fc51ea499018db8e74`. Readiness passed. The owner store now has 36 products: six starter products and 30 synthetic hardware demo products.

The local sago-agent-native .env Google key belongs to gen-lang-client-0061489912, whose billing is enabled. It was not copied. Instead, the existing Gemini-only key in invisible-erp was retrieved privately and saved in the root-only VPS environment. Cloud Billing reported billing disabled on invisible-erp. All existing WhatsApp, database and Access credentials were preserved. No secrets are included in this report or the release bundle.

A synthetic PVC cutter query succeeded through the live Gemini provider, with billing_state=free_declared, 8,659 input tokens and 90 output tokens; no WhatsApp message was sent for that diagnostic. The actual approved test phone then sent “I want a cutter for PVC pipe”: Gemini succeeded (9,861 input tokens, 74 output tokens), and the catalog-backed H19 reply was delivered. The old mock draft still contained duplicate cutter entries. The user was given the existing “clear my list” command to start a fresh test without deleting message history.

The dashboard visibly shows “Enabled · Gemini free-only,” paid inference disabled, and $0 recorded AI cost. The public privacy policy now describes Google Gemini text/context processing. Controls retain 10 requests per minute, six-second spacing, 200,000 input tokens per minute and the existing 100 attempts per Pacific day cap.

Private rollback backups on the VPS: /var/backups/shopbot-migration/ai-text-20261005T074842Z (before catalog/environment changes) and owner-20261005T074847Z (release activation). Reverting AI requires restoring the pre-activation environment together with the previous release. The import is additive; histories and requests were not deleted.

An automatic approval review rejected an initial broad audit. The replacement query constrained every read to the exact allowlisted test recipient ending 7308 and the configured Meta sender; that scoped audit succeeded. No unrelated chat inspection was performed.

Remaining: WhatsApp media handling is not connected; demo stock is not verified live merchant stock. The language model may still propose weak alternatives, so catalog-backed options require customer clarification and product confirmation. This deployment verifies the text AI connection rather than claiming all media or merchandising behavior is finished.

Fresh actual phone test at 07:59 UTC: after “clear my list,” “Show me PVC pipe cutter options” succeeded through Gemini (9,066 input tokens, 95 output tokens, free_declared, no validation failure). The delivered reply contained only H19 Ratchet PVC Pipe Cutter 42mm at ₹350, asked about PVC pipe size/thickness, and did not repeat the corrupted mock query or duplicate list entries.
