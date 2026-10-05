# WhatsApp text AI repair

The WhatsApp channel always constructed MockInterpreter. Its owner store had six starter products, and delivered/read replies were omitted from conversation history. These explain the repeated old query and missing hardware suggestions.

The channel now accepts the free-only Gemini adapter under WHATSAPP_AI_ENABLED, with paid inference disabled and zero paid budget. Delivered/read/accepted replies remain available as context. Displayed product codes are validated against current conversation options before selection. The synthetic hardware import is additive; existing messages and requests are preserved. This is demo catalog data, not verified merchant inventory.

The dashboard and public policy describe Gemini text processing. WhatsApp image and voice processing remain unconnected. Existing recipient allowlisting, webhook signatures, dashboard access, and send controls remain in place.

Validation: 116 integration tests passed; production build passed. Regression coverage includes scoped catalog import, delivered history, free billing state, and selecting a displayed code without another inference call. Deployment evidence follows after activation.
