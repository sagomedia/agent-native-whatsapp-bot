# 003 — Photo and voice adapters

Status: queued. Dependencies: 002.

## Work

Implement bounded photo analysis and voice transcription adapters with shared structured search output. Compare approved candidates, clarify unknown specifications, and record actual usage. Evaluate stored image embeddings only if they improve the baseline.

## Completion evidence

- Photo and voice input both reach the same exact-SKU selection flow.
- Ambiguous, blurred, absent-product, and failed-provider inputs recover sensibly.
- Real photos/recordings test quality; mocked adapters are labeled as mocks.
- Cost measurements distinguish transcription, vision, embeddings, and text.

Missing API credentials block live calls, not adapter/interface development. Missing real photos blocks measured store matching quality.
