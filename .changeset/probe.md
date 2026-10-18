---
'@alexgsdev/claude-ai-transcript-export': minor
---

`caitx probe <export>` reads a claude.ai account export and reports its schema: conversation and message counts, senders, block types, tool names, forks, and anything the specification does not handle. It accepts the export directory as downloaded (checking that every part its manifest lists is present), a single zip, or a bare `.json` or `.dms` conversations file, and never opens the `light_metadata` part. It counts and names, and never prints a value from a conversation.
