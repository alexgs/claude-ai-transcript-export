# caitx — brief

Status: draft, 2026-10-18. Precedes a full specification.

## 1. Purpose

`caitx` reads a claude.ai account export and writes selected conversations as
markdown transcripts into a repository, in the same format `cctx` writes
Claude Code sessions: numbered, speaker-labelled turns under YAML frontmatter,
plus an index.

It is a separate program from `cctx` on purpose. `cctx` exists to rescue logs
from a cache that prunes them, and nearly every rule it keeps answers a
property of those logs — the depth-one scan, membership by `cwd`, subagent
directories. An export has none of those properties. What the two share is the
back half of the pipeline, and `caitx` gets that by depending on
`@alexgsdev/claude-code-transcript-export` (see that repository's spec 05).

The durability argument still applies, in a weaker form. An export is a
point-in-time copy. A conversation deleted on claude.ai is missing from every
later export, so **the transcripts in the repository are the durable record,
not the export**, and the rules `cctx` keeps for that — never sync the output
to the input, carry the index forward from disk — carry over unchanged.

## 2. Scope

In scope:

- Reading the conversations in a claude.ai export, from the zips directly.
- Selecting conversations by conversation uuid, and by project (§5, which is
  the hard part).
- Rendering one branch of each conversation (§6) as a transcript, plus an index.
- Idempotence: a rerun over the same export writes zero files.

Out of scope for the first version:

- Design chats, artifacts (`frames-*.zip`), memories, and project documents.
  Each is a possible later feature; none is a conversation transcript.
- `light_metadata-*.zip` — `users.json` and `login_history.json`. **Never
  read.** Nothing a transcript needs is in it, and login history is the kind
  of data a tool should not be able to leak by accident.
- Fetching anything from claude.ai. The export is the only input.

## 3. Observed data

Surveyed from one real export, created 2026-10-18 (export format
`"version": "1.0"` in `manifest.json`). Counts are from that export and are
evidence, not guarantees: like Claude Code's logs, the format is undocumented
and will drift.

### 3.1 The export

A directory holding `manifest.json` and one zip per category, each named
`<category>-<part>.zip`:

| Zip | Contents |
| --- | --- |
| `conversations-000.zip` | One `conversations.json`: a single 211 MB JSON array |
| `projects-000.zip` | `projects/<uuid>.json`, one per project |
| `design_chats-000.zip` | `design_chats/<uuid>.json` |
| `frames-000.zip` | `artifacts/<uuid>/artifact.json` plus versioned files |
| `memories-000.zip` | `memories/<uuid>.json` |
| `light_metadata-000.zip` | `users.json`, `login_history.json` |

**Decided:** `caitx` accepts all three input forms, detected from what the
path is. An export directory means reading `manifest.json` and every
`conversations-*.zip` part. A single zip is also accepted, and so is a bare
conversations file, which may be `.json` or `.dms` (§5.1).

The `-000` part number means a large account may be split across several
`conversations-*.zip` files. Read every part, and treat a manifest that lists
a part not on disk as an error rather than silently exporting fewer
conversations.

### 3.2 Conversations

1,286 conversations, 20,591 messages, 2 conversations with no messages.

A conversation has exactly `uuid`, `name`, `summary`, `created_at`,
`updated_at`, `account` (`{ uuid }`) and `chat_messages`. **Nothing else** —
in particular no model, no project, and no marker for which branch is current.

A message has `uuid`, `parent_message_uuid`, `sender` (`human` 10,320 /
`assistant` 10,271), `text`, `content`, `attachments`, `files`, `created_at`
and `updated_at`.

`text` and `content` disagree in 6,466 messages: the `text` is not contained in
the joined text blocks. Render from `content`; treat `text` as a fallback for a
message whose `content` is empty, and say so if that happens.

### 3.3 Content blocks

| `type` | Count | Notes |
| --- | --- | --- |
| `text` | 24,931 | May carry `citations` (1,797 `web_search_citation`, with `url` and character offsets) |
| `thinking` | 9,791 | |
| `tool_use` | 8,898 | 57 distinct tool names (§7). An earlier count of 58 included an empty `name` that appears only on some `tool_result` blocks |
| `tool_result` | 8,889 | `name`, `is_error` (234 true), `content[]`, plus `display_content` for the UI |
| `token_budget` | 1,119 | Harness bookkeeping |
| `injected_prompt_block` | 475 | Always on `human` messages; harness-injected context, not authored (§7) |
| `image` | 41 | `source` is always null: no bytes |
| `document` | 13 | `file_uuid`, sometimes `title`; no bytes |
| `flag` | 3 | Has `flag` and `helpline` fields |

### 3.4 Attachments and files

- `attachments[]` (617): `file_name`, `file_size`, `file_type` (often `""`) and
  `extracted_content` — the text claude.ai extracted from an uploaded file.
- `files[]` (1,455): `file_uuid` and `file_name` only. **No bytes anywhere in
  the export**, for these or for `image` blocks, so every image renders as a
  marker. Nothing like `cctx`'s image extraction is possible.

## 4. Relationship to the `cctx` library

`caitx` builds a `TranscriptSession` per conversation and uses, unchanged:
`renderTranscript` (with `source: 'claude-ai'` and `fields` for the
conversation URL), `sessionFilename`, `slugify`, `writeIfChanged`,
`pruneRenamed`, `readTranscripts`, `parityStatement`, `parityReport`, `fence`
and `toLocalDate`. It writes its own index, since `renderIndex`'s prose is
about Claude Code.

It needs `cctx` 0.2.0 or later, the release that carries those API changes.

The README's "Conversations from somewhere else" section in that repository is
close to `caitx`'s write loop already.

## 5. Selecting by project: the export does not say

**The export records no link between a conversation and a project, in either
direction.** Conversations have no project field. Project files have `uuid`,
`name`, `description`, `docs[]`, `prompt_template` and flags, but no list of
conversations. This was checked several ways:

- Project uuids do appear inside conversations, but only in harness context.
  Nearly all hits are in `injected_prompt_block` prompts from the memory
  system, and 77 conversations each mention 17 projects — a listing of every
  project, not membership.
- 251 conversations call `project_knowledge_search`, which proves a
  conversation was *in* a project but not *which*. None of its 9,686 results
  match a project document by uuid or filename; their `metadata` and `url` are
  empty.
- `projects-000.zip` was searched for every conversation and message uuid.
  All 19 project files have the same ten top-level keys, none of them a
  conversation list. No message uuid appears. 23 conversation uuids appear in
  one project, all inside the text of its uploaded documents — chat URLs and
  `uuid: … url: …` headers in what look like saved conversation excerpts.
  That is prose citing conversations, covering one project of 19, not a
  membership record.

So selecting by project needs a source of membership the export does not
provide. The options:

1. **The config names the conversations.** A project in `.caitx.yaml` is a
   name, an optional project uuid recorded in frontmatter, and a list of
   conversation uuids. Explicit, auditable, and the same selection-by-uuid
   discipline as `cctx` §5.1. The cost is that the author has to collect the
   uuids, from the claude.ai UI's conversation URLs.
2. **Infer membership heuristically**, from tool paths, knowledge-search
   results or injected prompts. Rejected: the evidence above shows those
   signals are absent or misleading, and a wrong guess puts a conversation
   from one project into another's committed transcripts.
3. **Read membership from somewhere other than the export.** Out of scope by
   §2.

**Decided: (1), fed by an imported link list.** Hand-typing uuids is fine for
ten conversations and not for a hundred, so a project in `.caitx.yaml` can
point at a file of claude.ai chat URLs or bare uuids, one per line. Anything
on a line that is not a conversation uuid is ignored, so a list copied off the
project page in a browser works as-is. The list is captured once per project.
After that, `caitx list --since <date>` shows only conversations created since
the last run, so keeping it current means reading a short list. Notes are
optional, or set once per project: a required note on each of a hundred
conversations would be a chore.

Ways to get the list:

- **Ask Claude inside the project.** Its chat-history tools are scoped to the
  project's conversations. They appear in this export as `recent_chats`
  (14 calls) and `conversation_search` (520). Claude's reply can be pasted in
  as-is, since anything that isn't a uuid is ignored.
- **Copy links off the project page** in a browser.

Two checks keep a captured list honest. **Every uuid in the list must exist
in the export, or the run fails**, as in `protocol-era` (§5.1). That catches
a uuid a model made up or copied wrongly. **Missing conversations are not
caught by anything in the export**: history tools return results in pages,
and a reply can stop early. `caitx` prints how many conversations each
project's list resolved to, so that number can be compared once with the
project page.

This also makes "select by project" and "select by conversation" one
mechanism, not two.

Inferring membership from the export was tried and fails even as a
suggestion. Only 6 of 19 projects export any documents, because knowledge
synced from GitHub or Drive is not included. Of the 250 conversations whose
`project_knowledge_search` results name files, 152 match no project's
document names, 56 match several, and 42 match exactly one.

### 5.1 Prior work: `protocol-era`'s extractor

`protocol-era` has a working predecessor:
`apps/setting/scripts/extract-conversations.ts`, documented in its
`docs/tooling.md`. **It never selected by project.** The word does not appear
in the script in any revision. Selection was `allowlist.json`: ten
conversations, each matched by `uuid` exactly or by `title` case-insensitively,
each with a required `note`. One note reads "Lives outside the project; title
match", so the other nine were the project's threads, collected by hand. That
is option (1) in practice, and it worked.

Worth carrying over from it:

- **A `note` on every selected conversation.** "It is the only record of why a
  thread was worth committing."
- **An entry that matches nothing is a failure**, not a warning. It usually
  means a mistyped uuid or a renamed thread.
- **Title matching, as a discouraged fallback.** Titles change; uuids do not.
- **The conversations file may not be `.json`.** It looked for any entry whose
  name stem is `conversations` because "some exports use `.dms`".
- **`--probe` before the first extraction from a new export**, printing key
  names and block types without writing anything.
- **Tool payloads kept by default**, because "the earlier setting bible in this
  corpus exists nowhere else" (§7).

What it did not do:

- **Branches.** It renders `chat_messages` in array order and never reads
  `parent_message_uuid`. In this export, `61b697dd` — 310 messages, the largest
  conversation on that allowlist — has a fork, so its committed transcript
  likely contains an abandoned branch stitched into the main one.
- **Sharded exports.** It reads one zip, and refuses a directory. The
  2026-10-18 export is a directory of per-category zips (§3.1).

## 6. Branches

Conversations are trees. Every message has a `parent_message_uuid`, and the
root's parent is always `00000000-0000-4000-8000-000000000000`. An edited
prompt or a regenerated reply starts a sibling branch.

- 87 of 1,286 conversations fork, at 106 fork points in total.
- **Array order interleaves branches.** It has exactly 106 adjacent
  same-sender pairs — one per fork point — so rendering the array as-is would
  stitch abandoned branches into the transcript.
- The export does not mark the current branch. Following the **latest-created
  leaf** back to the root is the rule (decided), and in all 87 forked
  conversations the latest leaf is also the last message in the array, so the
  two possible heuristics agree on this export.
- Along that path: 0 conversations start with an assistant turn, and 15
  same-sender pairs remain across all conversations. Measure them the way
  `cctx` does (adjacent pairs, never index parity) and report them in the
  index.
- 225 of 20,591 messages are off the chosen path.

**Decided:** dropped branches are visible, not silent. Their count goes in the
frontmatter, for example `branches_dropped: 2`, so a reader knows the
transcript is one path through a tree. Rendering every branch is not planned.

## 7. Content policy

`cctx` strips tool calls because anything authored in a Claude Code session
lands in the working tree, where git captures it (`cctx` spec §6.1). **That
argument does not hold here.** A file Claude created in a claude.ai
conversation exists only in the conversation, and maybe as an artifact in
`frames-*.zip`.

`protocol-era`'s extractor reached the same conclusion from the other
direction: it kept every tool payload by default, as fenced JSON, because a
document generated in a conversation existed nowhere else (§5.1). The cost was
documents stored as escaped JSON strings, unreadable without decoding. Below,
authored content is kept, but rendered as the document rather than as JSON.

Tool calls by frequency: `bash_tool` 1,547, `str_replace` 1,366, `view` 1,244,
`project_knowledge_search` 1,156, `create_file` 873, `web_search` 817,
`present_files` 639, `conversation_search` 520, `web_fetch` 150, `artifacts`
61, `ask_user_input_v0` 43, then a long tail of memory, widget, docs and
connector tools.

**Decided: follow `cctx`'s approach.** Tool calls are stripped by default.
A call is preserved only by a named exception, and each exception is
justified the way `cctx` specs 02 and 04 are: the call holds authored content
that exists nowhere else. A preserved call renders as prose or as the
document, never as escaped JSON. A policy flag keeps everything, as
`--keep-tools` does in `cctx`.

The likely exceptions, each to be argued in the specification:

| Content | Default |
| --- | --- |
| `text` | Verbatim |
| `thinking` | Dropped, as in `cctx` |
| `create_file`, `artifacts` (authored content) | Preserved, as the document, with its file name or artifact title |
| `ask_user_input_v0` answers | Preserved, the same argument as `cctx` spec 02 (answered question widgets) |
| `present_files` | Probably preserved as a marker naming the files, like `cctx` spec 04 (`SendUserFile`) |
| Every other `tool_use` / `tool_result` | Stripped |
| `injected_prompt_block`, `token_budget` | Dropped: harness context, like `cctx`'s `system-reminder` handling |
| `image`, `document`, `files[]` | Marker with name (and size, when known) |
| `attachments[]` | **Decided:** marker with name and size, such as `> [attachment: notes.md, 12 KB]`; a policy flag inlines the extracted text in a fence |
| `flag` | Visible marker |
| Any unknown block type | Visible marker, never a silent drop |
| Citations | **Decided:** deduplicated source URLs listed at the end of the assistant turn; the prose is left untouched |

`display_content` on tool results is UI rendering and is ignored.

**Decided: files edited after they were created are replayed.**
`str_replace` (1,366 calls) edits files that `create_file` made: 175 created
files were edited later, 29 of them ten times or more. Preserving
`create_file` alone would keep the first draft and present it as the
document. Instead, the edits are applied and the finished document is
rendered once, where it was last presented or edited, with a short marker at
the creation and at each earlier edit pointing forward to it.

Every edit records its exact `old_str` and `new_str`, so a replay is
deterministic. It can still fail to apply — a file also changed through
`bash_tool`, or an edit with no `path` (14 calls). When it fails, that file
falls back to its created text plus each edit as a diff fence, in place, and
the run says so. A replay that half-applies must never be presented as the
document.

## 8. Output

The same as `cctx`, through its library:

- `<date>--<slug>--<id8>.md`, via `sessionFilename`, so the library's
  read-back and rename pruning recognize the files.
- Frontmatter: `title`, `session_id` (the conversation uuid), `source:
  claude-ai`, `created`, `updated`, `turns`, `extracted`, plus `url:
  https://claude.ai/chat/<uuid>` and the configured project, through `fields`.
  The account uuid is not written.
- Dates are local, via `toLocalDate`, from the conversation's `created_at` and
  `updated_at`.
- Title is `name`. **Decided:** a conversation with no name (30 here, and
  every one also has an empty `summary`) takes the first line of its first
  human turn, truncated. A frontmatter field records that the title was
  derived, so it is not mistaken for one the author or claude.ai gave it.
- `index.md` written by `caitx`, using `parityStatement` and rows carried
  forward from `readTranscripts`, so a conversation missing from a newer
  export keeps its row.
- Deletion is as narrow as in `cctx`: renamed transcripts only, reported.

## 9. Open questions

Decided 2026-10-18: project selection by imported link list (§5); latest
leaf, with dropped branches counted (§6); tool calls stripped except named
exceptions, as in `cctx` (§7); attachments as markers, with extracted text
behind a flag (§7); edited files replayed to their final state (§7);
citations as a sources list per turn (§7); untitled conversations named from
the first human line (§8); all three input forms (§3.1).

Still open:

1. **CLI shape**: probably `caitx [extract] <export>`, `caitx list <export>`
   and `caitx probe <export>` (schema-drift report, as in `cctx`), with config
   in `.caitx.yaml`. To be settled in the specification.

## 10. Testing

As in `cctx`: unit tests over pure functions, end-to-end runs in a temp
directory, and a `probe` snapshot over a checked-in **synthetic** export that
exercises every block type above plus a fork. A real export is never checked
in. It holds every conversation in the account, and CI must never need one.
