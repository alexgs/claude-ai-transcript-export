---
'@alexgsdev/claude-ai-transcript-export': minor
---

`caitx [extract] <export>` writes the selected conversations as markdown transcripts, through the cctx library, with an `index.md`. Frontmatter records `source: claude-ai`, the conversation's URL, its project, and, where they apply, `title_derived` and `branches_dropped`. The account uuid is never written. A rerun over the same export writes nothing, and so does a newer export where only a conversation's `updated_at` moved. Renamed transcripts are pruned, and excluded ones deleted. A transcript whose conversation left the export, or was taken out of a link list, is kept, reported, and carried in the index, project and all. Supports `--out`, `--keep-tools`, `--keep-thinking`, `--inline-attachments`, `--dry-run` and `--json`.
