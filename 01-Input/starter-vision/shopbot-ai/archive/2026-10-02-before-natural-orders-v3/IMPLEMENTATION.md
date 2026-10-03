# Reviewed implementation order

Eight working slices. Documentation describes required deliverables, not an existing app.

| Slice | Result |
| --- | --- |
| 001 | app + PostgreSQL start, safe migration/seed, persistent simulator |
| 002 | first text interpretation -> catalog/clarification/cart flow, native adapter and metering |
| 003 | image/voice flows with combined interpretation evaluated |
| 004 | durable WhatsApp adapter and outgoing delivery |
| 005 | minimal owner dashboard, MCP, drafts/voice-change proposals |
| 006 | approved product payments and separate usage invoices |
| 007 | second profile and onboarding/import configuration |
| 008 | clean setup, recovery/isolation/cost/quality and real-store evaluation |

The dashboard shell starts in 001; full conversational owner features wait until their services are ready. All confirmed features stay in scope.

## Source layout

apps/server/src/{http,jobs,runtime,services,adapters,db}; apps/dashboard/src/; packages/contracts/; profiles/; tests/; deploy/.

Do not create empty packages/services simply to mirror a diagram. One app entrypoint mounts HTTP and bounded pg-boss consumers. Later a worker entrypoint can reuse the same code.

## Startup acceptance

After creating local .env from documented placeholders:

- docker compose up --build

Mock first boot waits for PostgreSQL, runs versioned migrations with a startup lock, seeds idempotently, and exposes the dashboard/simulator. Readiness stays false until setup succeeds. A second boot preserves work.

Maintenance/test scripts are also required, for example docker compose run --rm app npm run test:integration and explicit migration/reset commands. Live reset/seed must refuse to destroy/populate live records.

Mock mode requires no paid keys. Live calls require credentials and authorized spend.

## Early compatibility spike

Before expanding the runtime, verify selected pinned @google/genai/Node/model/API versions with one schema-valid text call and, when authorized, image/audio calls.

Check native usage fields, mixed-modality accounting, output truncation, call IDs/history/signatures for any optional function continuation, timeout behavior and actual rate mapping. Do not assume automatic function calling or beta features are stable simply because a sample uses them.

The model remains a candidate until accuracy/cost tests pass. Native SDK and Vercel AI SDK alternatives are judged by implementation/maintenance fit; identical provider payloads have identical underlying tariff assumptions.

## Initial limits to evaluate

- Known buttons/IDs/confirmation: target zero model calls.
- Open text/media: target one interpretation.
- Ordinary turn: initial maximum two provider attempts, including retry/follow-up.
- Candidate set: initial five; small recent context plus structured state.
- Voice: initial 60-second limit; image/audio byte limits documented.
- Short text/image schema and audio transcript have distinct output budgets.
- Truncation/schema failure cannot apply a write; optional retry counts against the ceiling.
- Store-period cost reservation and limits precede paid calls.

These are product starting targets, not provider maximums or proven optimal settings.

## Hosted operation and expansion

Begin on the available server with app/PostgreSQL, persistent media, HTTPS, secrets, backup/recovery and bounded concurrency. Verify actual server resources before quoting capacity.

Split the worker when measured media/CPU tasks interfere with API latency or independent scaling/restarts are needed. Add S3, vector retrieval, larger models, or additional providers only against the review's evidence gates.
