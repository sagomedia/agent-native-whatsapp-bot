# ShopBot AI — Codex starter project

Planning package, prepared 2026-10-01. There is no application implementation yet.

Build a 50-product trial for KSMC Grandson Hardwares: customers search through WhatsApp using text, photos, or voice notes; the bot prepares an order request; staff confirm it. The owner uses both an authenticated MCP connection and a small dashboard.

## Start here

1. Read `PROJECT.md` for the goal and trial scope.
2. Read `STATUS.md` for what is ready and what is missing.
3. Read `DECISIONS.md` to distinguish confirmed choices from proposals.
4. Open this directory in Codex and use `outputs/codex-start-prompt.md`.
5. Work through `work/queued/` in dependency order, starting with task 001.

`AGENTS.md` contains instructions for the coding agent. Other Markdown files provide project context and are referenced from those instructions.

## Organization

| Path | Purpose |
| --- | --- |
| `inbox/` | Unreviewed exports, photographs, and merchant notes |
| `areas/` | Plans for catalog, search, WhatsApp, owner tools, and operations |
| `work/queued/` | Work that has not started |
| `work/active/` | Work currently being implemented |
| `work/completed/` | Finished work with verification evidence |
| `resources/` | Reference material and fixture guidance |
| `outputs/` | Trial plan, results template, and Codex starting prompt |
| `archive/` | Superseded material |

The first trial contains 50 sellable SKUs, including similar variants. It does not establish readiness for the full 2,000–4,000-product store. Synthetic data can demonstrate the interface; real store records and photos are needed to evaluate product matching.
