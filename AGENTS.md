# Working on ShopBot

Use the local-disk checkout. On the prepared computer it is `/home/gk-pc/projects/shopbot-inventory-dev`. Run application commands from the repository root.

- For changes to shopping interpretation, catalog retrieval, product cards, quantities, consent, owner orders or MCP, follow the [product guide](docs/PRODUCT.md). Keep the store’s inventory and current customer-approved version authoritative. Add regressions with unfamiliar wording and another inventory type when changing semantic decisions.
- For local startup, routing recovery, test databases, metered evaluation or phone acceptance, use [local development](LOCAL-DEVELOPMENT.md). Preserve the private profiles, catalog, media, conversations and cumulative spending ledgers.
- For builds, branches, pull requests and acceptance tracking, use [contributing](CONTRIBUTING.md). Record automated checks separately from observations on an authorized phone.
- For an authorized change to the existing GCP installation, use the [VPS runbook](deploy/native/README.md). Confirm the running release independently of the Git branch.
