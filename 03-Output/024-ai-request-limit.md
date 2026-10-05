# AI quota increased to ten requests per minute — 5 October 2026

The owner requested at least ten requests per minute and supplied an AI Studio screenshot showing Gemini 3.5 Flash Lite allowances of 15 RPM, 250K input TPM and 500 RPD. The app's free quota guard has been changed from three requests per rolling minute with 15-second spacing to **ten requests per rolling minute with six-second spacing**.

The shared guard continues to serialize reservations across stores/conversations using the same database and project/model identity. Pending and unknown-usage calls reserve 64K input tokens; trustworthy settled prompt usage replaces that allowance. The rolling token budget is **200K input tokens**, leaving headroom below the displayed 250K quota. Consequently large or ambiguous calls can reach the token guard before the ten-request limit. The existing application daily cap remains **100 requests**, resetting at Pacific midnight; the owner requested the minute-cap change, not a daily-cap increase. Failed and unknown calls count, each free message receives at most one attempt, and a provider 429 retains the 15-minute cooldown with no automatic retries or model fallback.

The preflight command reports the same exported limits used by enforcement, avoiding stale hard-coded diagnostic values. No paid inference flag or budget was enabled. This quota deployment does **not** connect the native AI interpreter or image/voice processing to WhatsApp; its already enabled replies remain deterministic until that separate integration is implemented.

Google documents that [limits are per project and RPM, input TPM and daily limits all apply](https://ai.google.dev/gemini-api/docs/rate-limits). Other applications/databases can consume the same Google quota outside this ledger, and Google may throttle below advertised capacity. A local zero paid budget cannot change the provider project's actual billing tier.

## Verification

- Production Node 22 typecheck and build passed.
- All **115 isolated integration tests** passed using mocked provider transport and a disposable local PostgreSQL database. No live Gemini request was made.
- Added a cross-conversation regression that admits ten small requests, denies the eleventh, retains unknown token reservations and releases those reservations only when settled usage becomes known. Existing immediate-spacing, provider 429 cooldown and daily-cap tests passed. A focused final native suite passed **32 tests**.
- The disposable test database was stopped and removed after verification. Application/business databases were not reset.

## Deployment

Source commit: **c8e0881**. Prepared slim release **preview-205710454fe4**, reusing the immutable runtime/dependencies from **preview-d8e6cf45a689** after checking identical dependency files. Archive size **5,681,693 bytes**, SHA-256 **2344a865c2dbba24862ff6b6311b32a97d72195f4c9bd01d7bd72004cda79c98**. The prior release and its backups are retained.

The release is **active on the VPS**. Its installed Node runtime imported the deployed quota module and printed `requestsPerMinute:10`, `minIntervalSeconds:6`, `inputTokensPerMinute:200000`, `requestsPerDay:100` and `reservedInputTokens:64000`. Readiness passed and app/retail tunnel were active. The environment file was byte-for-byte unchanged: WhatsApp receiver/processing/sending remain true; local AI/free inference/paid inference remain false.

Upgrade backup: **`/var/backups/shopbot-migration/owner-20261005T063523Z`**, containing the prior environment, PostgreSQL custom dump and previous release pointer. Archive listing passed; no full restoration drill was performed. Post-activation disk free: **1,142,857,728 bytes**. No resize, dependency reinstall, new tunnel or cloud resource was used.

The upload connection reset after the archive reached full size. Activation was withheld until the separately uploaded staging helper verified the exact complete archive checksum. Temporary remote upload/helper files and local one-hour SSH key files were removed after verification; installed releases/backups and data were retained. The original encrypted key was unchanged, and the expiring metadata grant was not represented as manually revoked.
