---
'@alexgsdev/claude-ai-transcript-export': minor
---

Files and artifacts Claude wrote in a conversation now render as documents. `create_file`, `str_replace` and `artifacts` operations are replayed, and the finished document is rendered once, fenced, where it was last edited or presented, with a marker at each earlier operation pointing forward to it. If any edit fails to apply, that document falls back to its created text plus each edit as a diff, and the run reports it. A document a shell command named after its creation says it may not be the final file. Edits to files never created in the conversation render as diffs in place. `tools: keep` turns the model off. `caitx probe` reports document counts.
