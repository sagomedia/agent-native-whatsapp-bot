# Temporary shared demo password

Approved scope: the existing KSMC owner dashboard and current data. Every password holder has the same owner access. There is no email, Google or SMS step in the application. The default remains Cloudflare identity authentication. This is a temporary demo mode; restore identity authentication before production.

## Configuration

Keep the existing owner hostname, shop ID, email, Cloudflare issuer and audience. Set `OWNER_LOGIN_MODE=demo_password`, `OWNER_DEMO_PASSWORD_HASH` and optionally `OWNER_DEMO_SESSION_HOURS` (1–168; default 24). Never store the plaintext password in source or environment configuration.

Generate the salted hash by supplying a 12–256 character password through stdin to `node dist/scripts/demo-password.js` from the packaged app, or `node --import tsx scripts/demo-password.ts` in the source checkout. Read it silently or from a private file; do not put it in command arguments or shell history. Save the hash as one literal environment value; its `$` characters must not undergo shell expansion. Restrict environment and credential files to the operator.

Sessions use a random token in a Secure, HttpOnly, host-only, SameSite=Lax cookie and a SHA-256 token hash in PostgreSQL. They are scoped to the configured shop, hostname and password hash, expire server-side, and survive application restarts. Sign out revokes the current session. Changing the salted password hash invalidates existing sessions. Persisted 15-minute limits allow 10 attempts per client and 120 globally; at most two expensive password checks run simultaneously per process. Passwords and cookie values are excluded from request logging.

Keep the app on loopback behind Cloudflare Tunnel. Cloudflare must overwrite `CF-Connecting-IP`; no other proxy or direct public origin may supply that trusted client header.

## Activation order

1. Confirm the newest deployed source, build and run the authentication, owner, full integration, catalog and browser checks. Use the existing checksummed immutable release and private database/environment backup upgrade process. Do not rerun installation or reset the shop.
2. Deploy the release with Cloudflare identity still enabled. Privately back up `/etc/shopbot-vps.env` and `/etc/cloudflared/config.yml`, plus the exact dashboard Access application and policies.
3. Set the opt-in environment values and restart `shopbot-vps`. Through loopback with the exact owner Host header, verify `/owner` redirects to `/login`, owner APIs reject missing sessions, wrong passwords fail, a successful login creates an authenticated session, and sign out revokes it. Do not weaken edge identity checks before these pass.
4. For **only** `shopbot-preview.sagoautomation.tech`, allow the password page to reach the application without the Cloudflare email identity prompt. Use an Access Bypass policy scoped to this dashboard application and remove its corresponding ingress `originRequest.access` JWT requirement in `/etc/cloudflared/config.yml`. Validate the ingress configuration before restarting the tunnel. Keep the existing public `demo.sagoautomation.tech` WhatsApp/MCP route, proxy, TLS, tunnel credentials, firewall and all unrelated applications/policies unchanged. This step requires an authorized Cloudflare account.
5. Verify from a fresh unauthenticated browser that the public dashboard goes directly to the password page, APIs remain gated, successful login shows current data, and logout blocks reentry. Check WhatsApp and MCP endpoints retain their previous behavior. Record the actual release fingerprint and exact private backup locations. A successful origin test alone does not prove the public email prompt is gone.

## Rotation and production restoration

To rotate, generate a new salted hash privately, replace only `OWNER_DEMO_PASSWORD_HASH`, restart, and verify the old password and sessions fail. To revoke all sessions without changing the password, delete `owner_demo_sessions` rows for the configured store; never truncate shop data. Rate-limit records are independent and normally expire by time.

For production, restore the backed-up Cloudflare Access identity policy and tunnel ingress JWT requirement first and validate the tunnel. Then set `OWNER_LOGIN_MODE=cloudflare` (or remove it), remove the demo hash, delete this shop's demo sessions and restart the app. Verify an unauthenticated browser requires Cloudflare login, a valid owner identity works, and a demo cookie cannot authorize any owner API. Keep issuer/audience settings intact throughout. The additive session tables may remain; they grant no access in Cloudflare mode. Do not restore an old database over current customer data to change authentication modes.
