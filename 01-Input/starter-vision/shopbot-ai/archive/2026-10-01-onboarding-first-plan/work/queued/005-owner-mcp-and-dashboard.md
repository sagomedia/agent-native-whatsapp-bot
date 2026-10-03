# 005 — Owner MCP and dashboard

Status: queued. Dependencies: 002 and order services from 004.

## Work

Expose catalog/import review, image/alias review, order review and explicit confirmation, plus usage visibility. Use one service layer for the dashboard and MCP. Add owner authentication, store/role authorization, and change audit records.

## Completion evidence

- Both interfaces read the same data and enforce the same business rules.
- Customer roles cannot perform owner actions or access other stores.
- Import/image review and order confirmation produce audit records.
- A local MCP test client works; chosen-host compatibility is tested when supplied.
- No unrestricted database or filesystem tool is exposed to the owner AI.
