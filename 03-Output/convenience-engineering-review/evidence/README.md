# Release evidence

Source: `7bdb45a1e39e95386da3aec19528f712b91f2130`. Deployment: `preview-ee77b7c4ba47`, schema35.

- `integration-summary.json`: 553 passed; zero failed/skipped; disposable PostgreSQL, mocked providers. Original log hash retained.
- `python-checks.txt`: four catalog preparation checks passed.
- `browser-proof.json` and PNGs: synthetic desktop1440/mobile390 owner flow, stock controls, persisted fact verification and disabled Tamil/Tanglish/English message previews. QR screenshots use an invalid sample recipient.
- `github-ci.json`: both hosted checks passed for the deployed source.
- `build-proof.json`, `package-proof.json`: source/artifact and immutable bundle identity.
- `deployed-readonly-smoke.json`: deployed owner snapshot, catalog, stock invariants and Tamil gallery passed using a database connection that rejects writes; live processing/sending/media/advance/demo flags preserved.
- `mcp-stock-privilege-check.txt`: inventory MCP can read new stock columns and cannot insert ledger movements (`t` then `f`).
- `deployment-proof.json`: fresh private backup, readiness, schema and 20-table offline preservation checks; zero retroactive stock changes.

Raw customer data, credentials and real audio/screenshots are excluded. These checks do not replace owner/device and bank settlement acceptance in issue #6.
