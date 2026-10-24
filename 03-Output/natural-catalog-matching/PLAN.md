# Accepted implementation scope

Repair mask and paint discovery from the deployed public-customer baseline. Use common catalog matching for purchase, price and lookup; preserve structured brand/colour/material/pack constraints; support grounded Tamil/Tanglish/English product wording. Keep numeric and product-type safeguards.

Show up to four matching options or three labelled alternatives with explicit customer selection. Preserve the exact original request and existing send-to-shop path when uncertain. Never equate no catalog match with no shop stock. Keep useful follow-up details and unrelated draft lines; ask one focused question and make shop submission prominent after two unsuccessful clarifications per item.

Use additive compatible JSON fields, existing models and budget, no embedding/classifier service and no merchant catalog rewrite. Verify at least 60 wording cases and eight multi-turn conversations, negative constraints, guard behavior, full integration/build, read-only live replay and backup-based deployment. Real-device acceptance remains open until actually performed.

This branch starts at the deployed source represented by public-customer PR #72, which remains open; main does not yet contain that source. Preserve that dependency explicitly in the new pull request.
