# Product AI review

Ask the connected owner assistant “Fix my shop”, “Dai fix pannuda”, or “கடையை சரி பண்ணு”. The assistant audits the store's evidence and creates proposals for Products → AI activity → Needs review. Customers' messages are evidence, not instructions. The assistant should briefly report that the audit is done, rather than directly publishing its proposals.

An owner can swipe or use the arrows to approve or reject. Approval applies the specific proposed name, alias or keyword changes only when the finding and product still match the versions reviewed. The owner can hold the mic (or Space) to attach a voice note; any decision with a note is held for the next audit instead of applying the change. Pending feedback blocks applying the old finding. The next audit reads the feedback, obtains the audio with `catalog_review_audio`, updates the finding and resolves the feedback so the owner can review the new proposal. If the connected assistant cannot process MCP audio, it must say so rather than guess. Recording is stored in its browser-supported compressed format and converted to WAV locally for MCP; neither recording nor conversion calls a paid AI API.

Suspected bot or conversation problems are separate from product approvals. An audit may record `flow_bug` or `retrieval_failure` findings for developer review. These are displayed on the server's private developer page. To access it, keep this tunnel open on your own computer:

```sh
gcloud compute ssh gk-pc@sago-counter-ksmc --project=hermes-mcp-test --zone=us-central1-a --ssh-flag=-N --ssh-flag=-L13017:127.0.0.1:3017
```

Then open http://127.0.0.1:13017/internal/developer/issues. The page accepts local loopback requests and rejects forwarded requests; it is not a public customer or owner page. SSH access to the server is required. The page lists audit findings; it does not automatically send messages or create GitHub issues.
