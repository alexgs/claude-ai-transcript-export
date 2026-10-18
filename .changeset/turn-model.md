---
'@alexgsdev/claude-ai-transcript-export': minor
---

`caitx probe` now also runs the turn model over every conversation and reports it: turns, alternation breaks on the chosen branches, conversations not starting with a human turn, empty human messages, branches dropped, and conversations it could not read. The library exports the pieces: `chooseBranch`, which follows a conversation's tree to its latest-created leaf; `buildTurns`, which turns a branch into numbered human and assistant turns, coalescing consecutive assistant messages; and `renderMessage`, which renders content blocks, attachments and files under a content policy.
