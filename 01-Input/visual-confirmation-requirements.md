# Customer visual confirmation — 3 October 2026

User requirement: an agent-native WhatsApp ordering assistant should show what it understood, including each actual product photo, name/specification and requested quantity. Exact matches also require explicit product acceptance because speech and catalog spelling can be wrong. Ambiguous items show alternatives tied to that specific requested line. Do not guess which pipe, size, brand or package the customer meant.

Group up to three requested items into one response, never exceed ten product cards in that envelope, and show the next group only in response to customer action. Preserve the whole requested list while clarifying it. Allow name/size/type corrections and quantity answers without silently submitting an order. “Add into catalog” in this conversation means add the displayed product to the customer's order list; it does not edit the shop's merchant catalog.

A photo selection confirms product identity. A separate final review and explicit customer confirmation authorize sending the request to the shop. Keep both actions version-bound, durable and replay-safe. Simple quantities, buttons and rechecks should not consume a Gemini request. Keep the current free-only inference limits and one outbound reply per processed turn.

Current implementation uses text messages, including future voice transcripts. Actual microphone capture, transcription and WhatsApp delivery are separate upcoming adapters. The carousel UI remains a local channel preview; real delivery must pass account/template/channel eligibility and billing rules.
