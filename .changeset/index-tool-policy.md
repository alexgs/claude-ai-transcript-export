---
'@alexgsdev/claude-ai-transcript-export': patch
---

The generated `index.md` now describes the tool policy its transcripts were written under. With `keepTools`, it names the tools kept as JSON; under `tools: keep`, it says every call is kept and documents have no final version. It used to say tool calls were stripped whatever the config. The default wording is unchanged, so existing indexes are not rewritten on upgrade.
