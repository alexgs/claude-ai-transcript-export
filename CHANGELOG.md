# @alexgsdev/claude-ai-transcript-export

## 0.2.0

### Minor Changes

- 96cc455: Add `keepTools` to `.caitx.yaml`: tools to keep as fenced JSON under the default `tools: strip`, every other tool still stripped and documents, questions and presented files still readable. For example, `keepTools: [conversation_search, web_search]` keeps what Claude retrieved. Listing a tool that is already preserved readably is a config error. Tool results are now labelled by the call they answer, found by `tool_use_id`, so a result with an empty `name` no longer renders as `tool_result:unknown`, under `tools: keep` too. `ContentPolicy` gains an optional `keepTools`.

## 0.1.1

### Patch Changes

- 89e5da3: Correct the README's release instructions. After a trusted publisher is added on npm, it stays pending until a publish arrives through it, so the first release needs a second, published through the workflow, to validate it; the tag-only rerun publishes nothing. Release steps now say to commit everything `release:version` changes, including a newly created `CHANGELOG.md`.

## 0.1.0

### Minor Changes

- 6b97f0c: Add `.caitx.yaml` and `caitx list <export>`. A config names projects, each fed by a link list: a pasted file of claude.ai chat URLs or uuids, from which every uuid is collected and project uuids are skipped. It can also name single conversations by uuid or, discouraged, by exact title, and an `exclude` list wins over every selector. A uuid that is neither in the export nor already a transcript fails the run, a conversation in two projects' lists is an error, and every project's resolved count is printed. `list` shows each conversation's status, with `--since`, `--unselected` and `--format list`. `--config <path>` reads exactly the file named.
- 4d3f5f2: Files and artifacts Claude wrote in a conversation now render as documents. `create_file`, `str_replace` and `artifacts` operations are replayed, and the finished document is rendered once, fenced, where it was last edited or presented, with a marker at each earlier operation pointing forward to it. If any edit fails to apply, that document falls back to its created text plus each edit as a diff, and the run reports it. A document a shell command named after its creation says it may not be the final file. Edits to files never created in the conversation render as diffs in place. `tools: keep` turns the model off. `caitx probe` reports document counts.
- 9a050e1: `caitx [extract] <export>` writes the selected conversations as markdown transcripts, through the cctx library, with an `index.md`. Frontmatter records `source: claude-ai`, the conversation's URL, its project, and, where they apply, `title_derived` and `branches_dropped`. The account uuid is never written. A rerun over the same export writes nothing, and so does a newer export where only a conversation's `updated_at` moved. Renamed transcripts are pruned, and excluded ones deleted. A transcript whose conversation left the export, or was taken out of a link list, is kept, reported, and carried in the index, project and all. Supports `--out`, `--keep-tools`, `--keep-thinking`, `--inline-attachments`, `--dry-run` and `--json`.
- 49574b3: Add `caitx init`, which writes a commented `.caitx.yaml` and refuses when a config already exists under either name. The README now covers the whole workflow: request an export, probe it, write the config, capture a project's link list, check the count, and extract. A document's final newline is no longer shown as a blank line inside its fence.
- 9bcfa34: `caitx probe <export>` reads a claude.ai account export and reports its schema: conversation and message counts, senders, block types, tool names, forks, and anything the specification does not handle. It accepts the export directory as downloaded (checking that every part its manifest lists is present), a single zip, or a bare `.json` or `.dms` conversations file, and never opens the `light_metadata` part. It counts and names, and never prints a value from a conversation.
- 575d122: `caitx probe` now also runs the turn model over every conversation and reports it: turns, alternation breaks on the chosen branches, conversations not starting with a human turn, empty human messages, branches dropped, and conversations it could not read. The library exports the pieces: `chooseBranch`, which follows a conversation's tree to its latest-created leaf; `buildTurns`, which turns a branch into numbered human and assistant turns, coalescing consecutive assistant messages; and `renderMessage`, which renders content blocks, attachments and files under a content policy.
