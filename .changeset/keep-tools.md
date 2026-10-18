---
'@alexgsdev/claude-ai-transcript-export': minor
---

Add `keepTools` to `.caitx.yaml`: tools to keep as fenced JSON under the default `tools: strip`, every other tool still stripped and documents, questions and presented files still readable. For example, `keepTools: [conversation_search, web_search]` keeps what Claude retrieved. Listing a tool that is already preserved readably is a config error. Tool results are now labelled by the call they answer, found by `tool_use_id`, so a result with an empty `name` no longer renders as `tool_result:unknown`, under `tools: keep` too. `ContentPolicy` gains an optional `keepTools`.
