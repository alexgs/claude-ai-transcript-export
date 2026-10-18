# caitx — specification

Status: draft, 2026-10-18. Builds on [01-brief.md](01-brief.md), whose
decisions this document treats as settled and whose observed-data section it
does not repeat. Section numbers in `cctx` are cited as "`cctx` §n"; they refer
to that repository's `docs/specs/01-initial-specification.md` unless another
document is named.

## 1. Purpose

Move selected claude.ai conversations out of an account export and into a
repository, as transcripts a human can read and a repository can diff.

The export is a point-in-time copy of something that can still change or
disappear on claude.ai. Where a decision is close, it goes to whichever option
loses less once a conversation is gone from every later export.

## 2. Scope

As brief §2. In short: conversations only, read from the export and nothing
else, selected by uuid or project link list, rendered one branch per
conversation, idempotently. Design chats, artifacts, memories and project
documents are out of scope. `light_metadata-*.zip` is never opened.

## 3. Observed data

Brief §3 holds the survey of the 2026-10-18 export. Facts found since, which
the rules below depend on:

- **Tool blocks are always on assistant messages.** All 8,898 `tool_use`,
  8,889 `tool_result` and 1,119 `token_budget` blocks. A human message holds
  `text`, sometimes with `injected_prompt_block`, `image` or `document`.
- **76 human messages have empty `content` and empty `text`.** 67 carry
  nothing at all; 9 carry only `files[]`.
- **Consecutive assistant messages happen.** Of the 15 same-sender pairs left
  on the chosen branches (brief §6), 14 are two assistant messages in a row,
  typically a reply that continued into a second message. One is two human
  messages.
- **After content policy, 10 alternation breaks remain** on the chosen
  branches, measured by `caitx probe` (§6.2). One is two human messages in a
  row. The other nine are an assistant reply with nothing visible between two
  human turns: four replies have no content at all, three are only tool
  calls, which are stripped, and two hold only whitespace text.
- **`ask_user_input_v0` records no answer.** Its `tool_use` input holds
  `questions[]`, each with `question`, `options[]` and sometimes `type`. Its
  `tool_result` repeats the questions back as JSON. The author's answer
  arrives as the next message, from `human`, in all 43 calls.
- **`artifacts` uses the same operations as the file tools.** `create`
  (23 calls; `id`, `title`, `type`, `content`), `rewrite` (11; `content`) and
  `update` (27; `old_str`, `new_str`), each with a `version_uuid`.
- **`create_file`** (873) has `path`, `file_text` and `description`; 3 calls
  have no `path`. 370 write under `/mnt/user-data/outputs`, the rest mostly
  under `/home/claude/<work dir>`.
- **`str_replace`** (1,366) has `path`, `old_str`, `new_str` and usually
  `description`; 14 have no `path`. Replayed against the text `create_file`
  wrote, 878 edits apply to exactly one place, 60 find no match and 1 matches
  twice. 413 target a file `create_file` never made, such as one uploaded or
  created through `bash_tool`.
- **349 `bash_tool` calls name a file `create_file` made**, so a replay that
  applies cleanly can still miss a change made in the shell.
- **A `tool_result`'s `name` can be empty.** It is the only name found on
  results and never on calls, so a result is matched to its call by
  `tool_use_id`, never by `name`.
- **`present_files`** (639) takes `filepaths[]`. Its result lists each file's
  `file_path`, `name`, `mime_type` and usually a `uuid`.

Counts are evidence from one export, not guarantees, as in `cctx` §3.

## 4. Input

`caitx` takes the export as a positional argument on every run. Exports are
downloads, and the next one lives somewhere else, so the path does not belong
in committed config.

### 4.1 Three forms

Detected from what the path is (brief §3.1):

| Path | Read as |
| --- | --- |
| A directory | An export. `manifest.json` is read, and every `conversations` part it lists must be present: a listed part missing from disk is an error, never a smaller export. |
| A `.zip` file | One part. The entry whose name stem is `conversations` is read, whatever its extension. |
| Any other file | A bare conversations file: `.json` or `.dms` (brief §5.1). |

A directory with no `manifest.json` is read as a directory of parts named
`conversations-*.zip`, with a warning, since nothing can confirm it is
complete.

Only the `conversations` and `projects` categories are opened. `projects` is
read for one thing: its project uuids, so a link list that contains one is not
mistaken for an unknown conversation (§5.2).

### 4.2 Reading zips

Zips are read in place; nothing is extracted to disk. The zip reader is the
one new runtime dependency (§13).

One `conversations.json` is a single 211 MB JSON array in this export, parsed
whole. Reading the whole 2026-10-18 export with `caitx probe` peaked at
1,147 MB of resident memory and took 4.2 seconds, which fits a desktop
machine comfortably. A streaming
parser is the fix if a larger account does not, and is not built until one
does (§15).

## 5. Configuration

`.caitx.yaml`, at the project root. Its location marks the root, found by
walking up from the current directory exactly as in `cctx` §4.1, and the
resolved root is printed on every run.

```yaml
# Where transcripts are written, relative to this file.
out: docs/conversations

# Whole claude.ai projects, each fed by a link list (§5.2).
projects:
  - name: Protocol Era          # recorded in frontmatter; required
    uuid: 0190…                 # recorded in frontmatter; optional
    list: conversations/protocol-era.txt   # relative to this file
    note: The setting project.  # optional

# Single conversations, in or out of any project.
conversations:
  - uuid: 61b697dd-…
    note: Original worldbuilding thread.
  - title: Tooling decisions     # discouraged; see §5.3
    note: Lives outside the project.

# Conversation uuids never written. Wins over everything above.
exclude: []

# Content policy (§7).
tools: strip          # strip | keep
keepTools: []         # tools kept as JSON anyway, under strip (§7.4)
thinking: drop        # drop | keep
attachments: marker   # marker | inline
skipEmpty: true       # skip conversations with no surviving turns

index:
  enabled: true
  preamble: null      # project-specific prose, inserted verbatim
  listExcluded: count # count | ids | none
```

Unknown keys are an error naming the key, as in `cctx`: a typo in `exclude`
that silently does nothing is how a conversation meant to be withheld ends up
committed.

### 5.1 Selection

A conversation is selected when a project's list or a `conversations` entry
names it and `exclude` does not. Then:

- **A conversation in two projects is an error.** claude.ai puts a
  conversation in at most one project, so two lists naming the same uuid means
  one of them is wrong.
- **A conversation both in a project and in `conversations`** is selected
  once and takes the project. The `conversations` entry's note still applies.
- **Notes are optional.** `protocol-era` required one on every entry (brief
  §5.1). That works for ten conversations and not for a hundred, so a
  project's note covers its list.

### 5.2 Link lists

A link list is a text file. It is meant to be pasted, so it is read
generously and checked strictly.

Reading:

- Every uuid on every line is collected, wherever it is on the line. A chat
  URL, a bare uuid and a line of Claude's prose that happens to contain one
  are all the same to the parser.
- A line starting with `#` is a comment.
- Duplicates collapse.
- A uuid that is one of the export's project uuids is skipped and reported. A
  pasted project URL carries one, and so may Claude's reply listing a
  project's chats.

Checking, after collection:

- **A uuid that is neither a conversation in this export nor a transcript
  already on disk is an error**, and the run writes nothing. This catches a
  uuid mistyped, copied from the wrong place, or made up by the model that was
  asked for the list (brief §5).
- A uuid with a transcript on disk but missing from this export is a
  conversation deleted on claude.ai since an earlier export. Its transcript
  stays, its row is carried in the index (§8.4), and the run reports it.
- Each project's resolved count is printed — *"Protocol Era: 97 conversations
  (95 in this export, 2 carried)"* — because nothing in the export can catch a
  list that is missing conversations. That number, compared once against the
  project page, is the only check.

### 5.3 Title selectors

A `conversations` entry may name a `title` instead of a `uuid`, matched
case-insensitively against `name`. It must match exactly one conversation;
none or several is an error. Every run that resolves one prints the uuid it
matched, with a suggestion to replace the title. Titles change on claude.ai
and uuids do not (`cctx` §5.1), so a title selector is a convenience for
writing the config, not a way to keep it.

## 6. The conversation model

### 6.1 One branch

A conversation is a tree of messages linked by `parent_message_uuid`; the root
message's parent is `00000000-0000-4000-8000-000000000000`. The rendered branch
is the path from the root to the **latest-created leaf**, by `created_at`.
Ties break toward the leaf later in `chat_messages`. In this export the two
rules never disagree (brief §6).

Messages off that path are dropped. A conversation with more than one leaf
gets `branches_dropped: n` in its frontmatter (§8.2), where `n` is the number
of leaves other than the chosen one. That counts branches rather than
messages, because a branch is what a reader can picture: `branches_dropped:
2` means "this transcript is one of three versions".

A message whose parent is neither the root sentinel nor another message in the
conversation is an error naming the conversation. None occur here; the rule
exists so that a format change fails loudly instead of producing a fragment.

### 6.2 Turns

A turn is one exchange, as in `cctx` §7.1:

- **A human message is a turn when it has visible content** after content
  policy: text, or a marker for an attachment, file, image or document.
  `injected_prompt_block` does not count; it is harness context (§7). The 67
  human messages that hold nothing are not turns.
- **Consecutive assistant messages coalesce into one turn**, separated by
  blank lines, as in `cctx` §7.3. That removes 14 of the 15 same-sender pairs
  on the chosen branches.
- **An assistant message with nothing visible** after policy contributes
  nothing. When that leaves two human turns adjacent, they stay two turns,
  and the index counts the break. This happens nine times in the observed
  export (§3). The alternative, a placeholder turn such as `> [no visible
  reply]`, would keep the alternation intact and tell a reader that the
  assistant did answer. It is not adopted, so that turn counts mean the same
  thing here as in `cctx`, but it is the obvious change if the breaks prove
  confusing.

Turn numbers are stable only while these rules are. A change here renumbers
transcripts, which the index says every time, as in `cctx` §7.4.

### 6.3 Content, not text

Each message renders from `content`. `text` disagrees with it in 6,466
messages (brief §3.2) and is used only for a message whose `content` is empty
and whose `text` is not. That never happens in this export. If it starts
happening, the message renders from `text` and `probe` reports how many did.

## 7. Content

### 7.1 Blocks

| Block | Rendered as |
| --- | --- |
| `text` | Verbatim. Its citations feed the turn's source list (§7.5). |
| `thinking` | Dropped. `thinking: keep` fences it, as in `cctx`. |
| `tool_use`, `tool_result` | Dropped, except the named exceptions in §7.2. `tools: keep` renders every call and result as fenced JSON, as `cctx` does. |
| `token_budget` | Dropped. |
| `injected_prompt_block` | Dropped. It is context claude.ai added to the human's message, the counterpart of `cctx`'s `system-reminder`. |
| `image` | `> [image: <name>]`, the name taken from the message's `files[]` entry with the same `file_uuid`. No bytes exist (brief §3.4). |
| `document` | `> [document: <title or name>]`, the same way. |
| `flag` | `> [flagged by claude.ai]`. Its `flag` and `helpline` fields are not rendered. |
| Anything else | `> [unhandled block type: <type>]`, never a silent drop. |

Per message, after its blocks:

| Field | Rendered as |
| --- | --- |
| `attachments[]` | `> [attachment: <file_name>, <size>]`. `attachments: inline` follows each marker with its `extracted_content` in a fence. |
| `files[]` | `> [file: <file_name>]`, for any file not already named by an `image` or `document` block in the same message. |

`display_content` on tool results is claude.ai's UI rendering and is ignored.

### 7.2 Tool exceptions

`cctx`'s rule, from its specs 02 and 04: a tool call is preserved, under the
default `tools: strip`, only when it holds authored content that exists
nowhere else. A preserved call renders as prose or as the document it carries,
never as escaped JSON. Every other tool call is stripped.

Three exceptions, each with its argument:

**Documents: `create_file`, `str_replace`, `artifacts`.** A file Claude wrote
in a claude.ai conversation is not in any working tree, and git never sees
it. `cctx` §6.1's reason for stripping tool calls does not reach it, and
`protocol-era` already found a setting bible that existed nowhere else (brief
§5.1). These render through the document model in §7.3.

**Presented files: `present_files`.** The call is how the author was shown a
file; without it, a turn that refers to "the file above" points at nothing.
It renders
as `> [presented: <name>, <name>]`, and it fixes where a presented document's
final version appears (§7.3). This is the counterpart of `cctx` spec 04
(`SendUserFile`).

**Questions: `ask_user_input_v0`.** The author's answer survives on its own,
as the next human message (§3). The questions do not: without them, an answer
like "the second one" is unreadable. So the questions render, the way `cctx`
spec 02 renders an answered widget:

```markdown
**Which tone fits the faction?**

- Grim and bureaucratic
- Swashbuckling
- Both, by region
```

The `tool_result`, which only repeats the questions, is not rendered.

### 7.3 The document model

A **document** is a file `create_file` made, keyed by its `path`, or an
artifact the `artifacts` tool made, keyed by its `id`. Within one
conversation, on the chosen branch, its operations are replayed in order:

| Operation | Effect |
| --- | --- |
| `create_file`; `artifacts` `create` or `rewrite` | Sets the full text |
| `str_replace` with that `path`; `artifacts` `update` with that `id` | Replaces `old_str` with `new_str`, once |

**Where it renders.** The final text renders once, fenced, in the turn holding
the document's last operation or the last `present_files` naming its path,
whichever comes later. It sits under a header line naming it and its history:

```markdown
**`/mnt/user-data/outputs/faction-guide.md`** — created in turn 12, edited
4 times, final version.
```

Each earlier operation leaves a marker in its own turn, pointing forward:
`> [document: faction-guide.md — edited; final version in turn 31]`.

The fence comes from `cctx`'s `fence`, which outlasts any run of backticks in
the content. A document is always fenced, never inlined, even when it is
markdown. An inlined markdown document brings its own headings into the
transcript's structure.

Fencing does not hide a line shaped like `## [3] Human` from the index's
read-back, though. `cctx`'s `readTurnHeadings` scans the whole body, fences
included. What protects the index is that function's own rule: it believes
the headings only when they number 1..n and agree with `turns:`. A quoted
heading breaks that, so the transcript's alternation goes unmeasured rather
than mismeasured, and its turn count still comes from the frontmatter
(`cctx` spec 03). Skipping fenced blocks in `readTurnHeadings` would recover
the measurement; that is a change to `cctx`, not made here.

**When a replay fails, the document is not presented as final.** An edit
whose `old_str` matches nowhere (60 in this export) or in more than one place
(1) fails the replay for that whole document. It then renders in place
instead: the created text in its creation turn, and each later operation as a
`diff` fence in its own turn, under a header saying the replay did not apply.
The run lists every document that fell back. A half-applied replay presented
as the finished document would be worse than either form, because it looks
right.

**Where an earlier operation shares the final version's turn**, its marker
says "final version below" rather than naming its own turn.

**When the shell may have changed it, the header says so.** A clean replay
proves only that the file-tool edits agree with each other. If any
`bash_tool` call after the document's creation names its path (349 calls name
a created path in this export), the header adds: *"also touched by shell
commands this transcript does not show; this may not be the final file."*
That is a string match, so it can false-alarm. It cannot miss a `bash_tool`
call that names the path, which is the side to err on.

**Edits to files `create_file` never made** (413 `str_replace` calls here,
plus the 14 with no `path`) have no document to apply to. Each renders as a
`diff` fence in place, headed with the path when there is one. This is still
authored content: the edit is the only record of the change.

A `create_file` with no `path` is a document of its own, keyed by its
position, and renders in place.

### 7.4 What the policy flags change

`tools: keep` renders every tool call and result as fenced JSON, the way
`cctx --keep-tools` does, and turns the document model off: with every
payload present, a replayed final version would show each document twice.
`thinking: keep` and `attachments: inline` change only the blocks they name.

**`keepTools`** names tools to keep as fenced JSON under `tools: strip`,
every other tool still stripped and the document model still on. It is for a
project whose own argument puts a tool on the right side of §7.2's line. The
case that prompted it: `protocol-era` adjudicates provenance, and
`conversation_search` results show what the model retrieved from earlier
conversations. That retrieved text exists elsewhere, so the default strips
it, but which parts were retrieved is evidence nowhere else records. Over
`protocol-era`'s ten conversations, `keepTools: [conversation_search,
web_search]` keeps 23 calls and their results and leaves every document,
question and presentation readable. Output grows from 668 KB to 1,121 KB,
against 1,450 KB for `tools: keep`.

A tool already preserved in readable form (the document tools,
`ask_user_input_v0`, `present_files`) cannot be listed: it would render twice.
A kept `bash_tool` still counts against the documents it names (§7.3). A
result is labelled by the call it answers, found by `tool_use_id` in the same
message, because a result's own `name` can be empty (§3); every result in the
observed export sits in its call's message.

### 7.5 Citations

Each `text` block's `citations[]` contributes its `details.url`. The URLs of
an assistant turn are deduplicated in first-cited order and listed after the
turn's prose:

```markdown
Sources:
- https://example.org/a
- https://example.org/b
```

The prose itself is not touched. The character offsets index into the
block's text before anything else in the turn is rendered or stripped, and
inserting links at them is a way to put a link in the wrong sentence.

## 8. Output

```
<out>/
  index.md
  2026-08-21--documenting-lom-jump-limit-setting-reference--6370e5b1.md
```

There is no image directory: an export holds no image bytes (brief §3.4).

### 8.1 Filenames

`<created>--<slug>--<uuid[0:8]>.md`, built with `cctx`'s `sessionFilename` and
`slugify`. Using that exact shape is what lets the library's `readTranscripts`
and `pruneRenamed` recognize the files (`cctx` README, "Conversations from
somewhere else").

### 8.2 Frontmatter

```yaml
title: Documenting LoM/Jump Limit setting reference
session_id: 6370e5b1-…
project: Protocol Era            # the configured name; omitted when none
source: claude-ai
created: 2026-08-21
updated: 2026-08-22
turns: 22
extracted: 2026-10-18
url: https://claude.ai/chat/6370e5b1-…
project_uuid: 0190…              # when the config gives one
title_derived: true              # only when §8.3 applies
branches_dropped: 1              # only when §6.1 applies
```

Everything after `extracted` is passed through the library's `fields` option,
which cannot override the keys above it.

`project` is the library's own key. In `cctx` it holds the project root's
path; here it holds the claude.ai project's name. The values differ in kind,
but both answer "which project is this from" for the source it came from.

The account uuid is never written. Nothing a reader needs is in it, and a
transcript should not carry an identifier for the account it came out of.

- `created` is the conversation's `created_at`, as a local date
  (`toLocalDate`, `cctx` §8.2).
- `updated` is the `created_at` of the last message on the rendered branch,
  also local. The conversation's own `updated_at` is not used. It can move
  without the rendered branch changing — a later abandoned branch, a rename —
  and a field that moves without the content moving rewrites the file for
  nothing (§9).

### 8.3 Titles

The title is the conversation's `name`, trimmed. A conversation with an empty
`name` (30 here, every one with an empty `summary` too) takes the first line
of its first human turn, truncated at the last word boundary before 80
characters, with `title_derived: true`.

A title, derived or not, can change between exports. When it does, the
filename changes and the old file is pruned as a rename (§10).

### 8.4 The index

Generated by `caitx`, not by `cctx`'s `renderIndex`, whose prose is about
Claude Code (`cctx` spec 05). It contains:

- A table of created, title, turns and conversation uuid, plus a project
  column when the config names more than one project. Each title links to the
  conversation's claude.ai URL.
- The turn-alternation statement from `cctx`'s `parityStatement`, measured,
  never asserted.
- A paragraph on what transcripts are: one branch, coalesced as in §6.2, and
  what happened to tool calls, worded from the tool policy the run used. The
  default says tool calls are stripped except documents and questions;
  `keepTools` adds the tools it names, kept as JSON; `tools: keep` says every
  call is kept and no document has a final version. *Corrected after 0.2.0:*
  the paragraph first gave the default wording whatever the config. The
  default wording is unchanged, so existing indexes are not rewritten.
- The exclusion count, as `cctx` §5.2.
- `index.preamble`, verbatim.
- **Rows carried forward** from transcripts on disk that this export cannot
  regenerate, read back with `readTranscripts`. Without them, a conversation
  deleted on claude.ai disappears from the index at the next export
  (`cctx` spec 03).

A carried row gets its project for the project column from
`CarriedTranscript.frontmatter`, added to the `cctx` library in 0.2.0 for this
purpose (§12).

## 9. Idempotence

As `cctx` §9. The renderer is pure. `writeIfChanged` renders with the
`extracted:` date already on disk and writes only when something else
changed. **A rerun over the same export writes zero files.**

The stronger property is the one that matters here: **a newer export in which
a conversation did not change writes nothing for it.** "Did not change" means
what is rendered: a moved `updated_at` alone writes nothing, while a new
branch does, since it changes `branches_dropped` and, being newer, usually
the branch rendered. That is why `updated`
comes from the rendered branch rather than from `updated_at` (§8.2), and why
nothing in the output reads a value that moves without the content moving.

## 10. Deletion

`cctx` §10, adjusted for a source that is a selection rather than a project:

1. **Renames.** A transcript is deleted when this run wrote a different
   filename for the same conversation. Titles change.
2. **Excluded.** A conversation added to `exclude` has its transcript deleted
   and reported.
3. **Deselected is not excluded.** A transcript whose conversation is in the
   export but no longer selected — dropped from a link list, a
   `conversations` entry removed — is kept, kept in the index, and reported
   with a pointer to `exclude`. Taking a line out of a pasted list is too easy
   to do by accident to be the way a committed transcript is destroyed.
4. **Nothing else, ever.** The output is never synced to the export.

Every deletion is printed.

## 11. CLI

`caitx [command] <export> [flags]`. Exit codes as `cctx`: `0` success, `1`
runtime failure, `2` usage or configuration error. A link-list uuid that
resolves to nothing (§5.2) is a configuration error.

### 11.1 `extract` (default)

Flags: `--config`, `--out`, `--keep-tools`, `--keep-thinking`,
`--inline-attachments`, `--dry-run`, `--json`.

Reports: the resolved root; the export read, with its `created_at` from the
manifest; each project's resolved count (§5.2); conversations written,
unchanged and carried; turns; branches dropped; documents rendered and any
that fell back (§7.3); skipped (empty, excluded); removed (renamed,
excluded); deselected (§10.3). Warnings and the `--json` summary follow
`cctx`'s rules: warnings on stderr, the summary on stdout.

### 11.2 `list`

Every conversation in the export: uuid, created, title, message count,
whether it forks, and status (`selected: <project>`, `selected`,
`excluded`, `not selected`).

- `--since <YYYY-MM-DD>` shows only conversations created on or after a date.
  This is how a project's list is kept current after the first capture (brief
  §5).
- `--unselected` shows only conversations nothing selects.
- `--format list` prints one uuid per line, ready to append to a link list.
- `--json`, as everywhere.

### 11.3 `probe`

As `cctx` §11.3: block-type and tool-name histograms, keys present on
conversations and messages, fork counts, and anything §7 does not handle. It
writes nothing. Run it on every new export before trusting `extract`; brief
§5.1 shows this format has already moved once.

### 11.4 `init`

Writes a commented `.caitx.yaml` in the current directory, refusing when one
exists.

## 12. Library

`caitx` is a consumer of `@alexgsdev/claude-code-transcript-export`, through
the API documented in that package's README and its spec 05. It uses
`renderTranscript`, `frontmatterFor`, `sessionFilename`, `slugify`, `fence`,
`toLocalDate`, `writeIfChanged`, `writePlainIfChanged`, `pruneRenamed`,
`pruneExcluded`, `readTranscripts`, `parityReport` and `parityStatement`.

It needs `cctx` **0.2.0 or later**. That release added the one thing this
specification asked of the library: `CarriedTranscript.frontmatter`, the whole
frontmatter block as parsed. With it, a carried index row gets back the
fields `caitx` wrote with `fields`, such as `project` (§8.4).

`caitx`'s own exports are kept small to begin with: reading an export,
selecting conversations, building a `TranscriptSession` from one, and the
whole run. They grow only when a consumer needs more.

## 13. Packaging

- Package `@alexgsdev/claude-ai-transcript-export`, bin `caitx`, repository
  `claude-ai-transcript-export`.
- Node ≥ 22, ESM only, TypeScript compiled with declarations.
- Runtime dependencies: the `cctx` library (`^0.2.0`), `yaml`, and a zip reader.
  `fflate` is the candidate: no dependencies of its own, and it can unzip a
  single named entry.
- Releases as in `cctx`: work on `develop`, changesets, `main` publishes
  through npm trusted publishing.

## 14. Testing

As `cctx` §13, plus:

- **The fixture export is built at test time** from checked-in JSON, into a
  temp directory: a manifest, a `conversations` zip and a `projects` zip.
  JSON diffs; a binary zip in the repository does not.
- It exercises every block type in §7.1 plus one unknown, a fork, consecutive
  assistant messages, an empty human message, a widget, a document replayed
  cleanly, one whose replay fails, one touched by `bash_tool`, an edit to a
  file never created, an untitled conversation, and a link list containing a
  chat URL, a project URL, a comment and a duplicate.
- A `probe` snapshot over that fixture fails when handling changes, as in
  `cctx`.
- **A real export is never checked in**, and CI never needs one. Before
  trusting a change to parsing, run `probe` and `extract --dry-run` against a
  real export locally.

## 15. Open questions

1. **Heap size.** A 211 MB `conversations.json` peaks at 1,147 MB resident
   (§4.2). The account size at which that stops fitting is unknown, and so is whether
   exports split conversations into more parts before that point.
2. **Artifacts in `frames-*.zip`.** The newer artifact system stores its own
   versions there, with no link to a conversation in `artifact.json`. If a
   conversation can be tied to its artifacts, they could render as documents
   too. Not attempted in the first version.
3. **`flag` blocks.** Three occur. The marker says only that claude.ai flagged
   the message; whether `flag` holds anything worth showing is unchecked.
4. **The 15th break.** One human-human pair survives on a chosen branch.
   Whether it is a real double message or a branch-selection artifact is
   unchecked; either way the index counts it.
