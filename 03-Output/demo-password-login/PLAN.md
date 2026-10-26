# Approved temporary shared demo login

The owner confirmed a single shared password, with no email address, Google login or SMS, and selected the existing KSMC dashboard and its current data. This is a temporary demo arrangement; production will return to identity-based authentication. Every password holder receives the same existing owner access.

Build from the exact latest deployed source 52c52c7935a0a563a0d8b35c12ab11010304dd52 (preview-2a58e8b0d292), preserving mobile photo optimization and audit work absent from main.

Implement an opt-in password login mode, server-side password verification, expiring revocable sessions, host/CSRF guards, throttled attempts, logout and password rotation. Protect pages and APIs. Default mode remains Cloudflare Access. Keep Cloudflare issuer/audience configuration for reverting production authentication. Do not reset or replace products, conversations, orders, photos, existing MCP grants or credentials. Do not publish the shared password in source, logs or GitHub.

Verify security and owner regressions, production build, mobile browser behavior and full integration checks. Deploy through the existing verified backup process. Activate and verify the application password gate before changing only the dashboard's Cloudflare Access/tunnel identity requirement. Preserve Cloudflare proxy/TLS and public WhatsApp/MCP routing. Back up and document the exact Cloudflare changes and identity-login restoration. Cloudflare account authorization may require the owner's connected account or a guided final dashboard change.
