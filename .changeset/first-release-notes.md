---
'@alexgsdev/claude-ai-transcript-export': patch
---

Correct the README's release instructions. After a trusted publisher is added on npm, it stays pending until a publish arrives through it, so the first release needs a second, published through the workflow, to validate it; the tag-only rerun publishes nothing. Release steps now say to commit everything `release:version` changes, including a newly created `CHANGELOG.md`.
