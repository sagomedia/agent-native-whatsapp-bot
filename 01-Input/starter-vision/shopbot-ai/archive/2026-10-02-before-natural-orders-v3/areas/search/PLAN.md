# Controlled interpretation and retrieval

Use @google/genai behind a small native/mock adapter. The application controller validates structured intent/evidence and calls role-scoped services.

Known selections/IDs target zero inference. Open text/media targets one; templates render routine questions/facts. Optional native tool continuation or comparison is bounded and metered.

Combine transcript/image observations and intent when quality permits. Keep observations reusable but intent tied to request/context.

Exact/specification/alias/PostgreSQL retrieval comes first. Add candidate comparison or embeddings if real photos show systematic misses. No claim of exact visual size/grade identification.

ARCHITECTURE-REVIEW.md explains SDK/model/agent/template/retrieval tradeoffs.
