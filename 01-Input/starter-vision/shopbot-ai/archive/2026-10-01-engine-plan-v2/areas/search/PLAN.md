# Agent runtime and search

Primary specifications: ARCHITECTURE.md and RUNTIME-FLOWS.md.

Implement ToolLoopAgent with role-scoped typed tools, trusted tenant context, durable conversation state, bounded history/candidates, explicit step/call/token budgets, and metered provider calls.

Separate deterministic button/known-ID actions from open language interpretation. Tool results carry authoritative product facts; AI asks for missing variant details rather than inventing them.

Customer input normalization supports text, image observations, and voice transcripts. Model/media adapters are replaceable; default evaluation candidate is Gemini 3.1 Flash-Lite.

Use mock adapters to prove runtime behavior and live adapters to prove model/media quality. Persist evidence and outcome, not just an untraceable final answer.

No independent discovery/planning/matching agents are required for each customer message. One relevant role agent runs a bounded tool loop.
