# Complete system notice delivery recovery

Follow-up to #66 and merged PR #67: live verification confirmed four later assistant replies delivered, but a newly generated quote notice remained queued behind the original obsolete unknown review. Extend the obsolete-review ordering exception to a new system notice only after a later assistant turn has confirmed delivery before that notice. Keep historical notices held, unknown evidence intact and active-review/multipart guards in place. Verify the current quote notification with a Meta delivery callback.
