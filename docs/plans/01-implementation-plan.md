# Implementation plan

Implements [`docs/specs/02-specification.md`](../specs/02-specification.md).
Section references (§) point into that document unless they name the brief or
`cctx`. This plan does not restate decisions; it puts them in order.

## Ordering principle

`cctx` built outward from the parts that touch nothing, and left the write
layer for last because it is the only part that can destroy anything. Both
halves of that hold here, with one exception at the front.

**The export reader and `probe` come first, ahead of the pure core.** The
specification's facts about the export come from one survey, done with
throwaway Python scripts against one export (spec §3, brief §3). Everything
after phase 1 is built on those facts. So the first working code reads the
real export and reproduces the survey's numbers. A mismatch found then costs a
paragraph of the spec; found in phase 5, it costs the phases in between.

**Writing still comes last.** Phases 1 to 4 write nothing outside a temp
directory, and the deletion rules (§10) are not reachable until the tests that
make them safe exist.

## Proposed layout

```
src/
  types.ts          raw export types, content policy
  input.ts          the three input forms, manifest, zips    (§4)
  probe.ts          histograms and drift report              (§11.3)
  tree.ts           branch selection, branches_dropped       (§6.1)
  blocks.ts         blocks, markers, citations, questions    (§7.1, §7.2, §7.5)
  documents.ts      the document model                       (§7.3)
  turns.ts          messages to turns, coalescing            (§6.2, §6.3)
  conversation.ts   conversation to TranscriptSession,
                    title, frontmatter fields                (§8.2, §8.3)
  config.ts         .caitx.yaml discovery and validation     (§5)
  linklist.ts       link-list parsing and checking           (§5.2)
  select.ts         selection rules, title selectors         (§5.1, §5.3)
  render/index.ts   the caitx index                          (§8.4)
  extract.ts        the whole run, writing through cctx      (§9, §10)
  cli/
    index.ts  list.ts  init.ts                               (§11)
  index.ts          library exports                          (§12)
test/
  fixtures/export/  JSON sources for the fixture export
  helpers.ts        builds the fixture export into a temp dir
```

## Phase 0: scaffolding and CI

Take the setup from `cctx` rather than rebuilding it, so the two repositories
stay alike to work in:

- `package.json`: name `@alexgsdev/claude-ai-transcript-export`, bin `caitx`,
  `type: module`, `engines.node >= 22`, Volta pinned to the same Node 22 and
  npm as `cctx`. Runtime dependencies `@alexgsdev/claude-code-transcript-export@^0.2.0`,
  `yaml` and `fflate`; dev dependencies as in `cctx`.
- `tsconfig.json` and `tsconfig.build.json`, Prettier with `docs/` and `*.md`
  ignored, vitest, changesets with `baseBranch: develop`.
- The four workflows: `ci.yml`, `require-changeset.yml`, `release-guard.yml`
  and `release.yml`. Keep `release.yml`'s filename, since npm trusted
  publishing is bound to it. Add `edited` to `require-changeset.yml`'s trigger
  types: PR #16 in `cctx` sat waiting on that check after being retargeted,
  because a base change fires `edited`.
- A `CLAUDE.md` in the same form as `cctx`'s, filled in as the code arrives.
- The GitHub repository, with `develop` as the default branch. Creating it is
  an outward-facing step, so it waits for the author to say go.

**Done when:** `npm run build` emits `dist/` with declarations, `npx .` prints
usage, and CI is green on a first pull request.

### 0.1 Nothing below the CLI reads the clock, the environment or the home directory

As `cctx`, and for the same reason: it is what lets CI run. The export path is
already a parameter (§4). Today's date and the current working directory join
it at the CLI boundary.

### 0.2 The fixture export is built, not checked in

`test/helpers.ts` builds an export into a temp directory from the JSON in
`test/fixtures/export/`: a `manifest.json`, a `conversations-000.zip` and a
`projects-000.zip`, zipped with `fflate`'s `zipSync`. JSON diffs in review; a
binary zip does not (§14). The fixture starts small in this phase and grows
with each phase that needs a new case.

### 0.3 What CI cannot do

The same limit as `cctx`, plan §0.2: CI guards the code, not the assumptions.
It has no real export and must never get one: a real export holds every
conversation in the account. Drift detection is `caitx probe` run locally
against a new export, and the README says so.

## Phase 1: export reader and `probe`

- `input.ts`: the three forms (§4.1); the manifest check that a listed part is
  on disk; a directory with no manifest read with a warning; the
  `conversations` entry found by name stem, so `.dms` works; only the
  `conversations` and `projects` categories opened.
- `probe.ts`: counts of conversations and messages; block types; tool names;
  keys on conversations and messages; forks; and anything §7 does not handle,
  listed by name.

**Tests:**

- Each input form reads the same fixture to the same conversations.
- A manifest listing a part that is not on disk is an error, and nothing is
  read from the parts that are.
- A corrupt `light_metadata-000.zip` in the export directory does not affect
  the run. It is never opened, so a run that succeeds proves it.
- A block type `probe` does not know is reported by name.

**Done when:** `caitx probe` against the 2026-10-18 export reproduces the
survey: 1,286 conversations, 20,591 messages, the block-type counts in brief
§3.3, 57 tool names, and 87 forked conversations with 106 fork points. Any
number that differs is resolved in the spec before phase 2 starts.

## Phase 2: the conversation model (pure)

`tree.ts`, `blocks.ts`, `turns.ts`. Document tools render as nothing in this
phase; phase 3 gives them their real form.

**Tests:**

- A fork follows the latest-created leaf. A tie breaks toward the later leaf
  in `chat_messages`. A message with an unknown parent is an error naming the
  conversation.
- `branches_dropped` is the number of leaves besides the chosen one, and
  absent when there is only one leaf.
- An empty human message is not a turn. A human message holding only
  `files[]` is a turn, carrying its markers.
- Consecutive assistant messages coalesce into one turn. Two adjacent human
  turns stay two turns.
- `injected_prompt_block` and `token_budget` render nothing; `thinking`
  renders only under `thinking: keep`.
- A file named by an `image` or `document` block is not marked a second time
  from `files[]`.
- Citations are deduplicated in first-cited order, listed after the turn's
  prose, and the prose is unchanged.
- `ask_user_input_v0` renders its questions and options; its `tool_result`
  renders nothing.
- An unknown block type renders a visible marker.
- A message with empty `content` and non-empty `text` renders from `text`.

**Done when:** `probe` also reports turns and alternation breaks on the chosen
branches, and every break against the real export is explained.

*Result:* 10 breaks, not the 1 this criterion first expected. That number came
from the survey, which counted message pairs before content policy. The other
nine are assistant replies with nothing visible, which spec §6.2 keeps as two
human turns. Spec §3 has the breakdown.

## Phase 3: the document model (pure)

The riskiest phase, so it stands alone. It is two passes:

1. Walk the chosen branch's turns, collecting each document's operations
   with the turn they occur in, plus every `present_files` and every
   `bash_tool` call that names a document's path.
2. Replay each document, decide where its final version goes, and render the
   markers that point forward to it. Turn numbers are known by then, which is
   what the forward markers need.

**Tests**, one for each rule in §7.3:

- A clean replay renders once, at the later of the last operation and the last
  presentation, with markers in every earlier operation's turn.
- An edit whose `old_str` matches nowhere, and one that matches twice, each
  fail the replay for the whole document. The document falls back to its
  created text plus `diff` fences in place, and the failure is reported.
- A `bash_tool` call naming the path after creation adds the warning to the
  header; one before creation does not.
- An edit to a file `create_file` never made, and an edit with no `path`, each
  render as a `diff` fence in place.
- A `create_file` with no `path` renders in place.
- An `artifacts` `create` followed by `update` and `rewrite` replays like the
  file tools.
- A document whose text contains `## [3] Human` and a run of four backticks is
  fenced so that neither escapes, and `cctx`'s `readTurnHeadings` still reads
  the transcript's real headings back correctly.
- Under `tools: keep`, the document model is off and every payload renders as
  JSON.

**Done when:** `probe` reports documents rendered, clean, fallen back and
shell-touched, and against the real export the edit-level counts agree with
spec §3: 878 applied, 60 unmatched, 1 ambiguous.

*Result:* they agree exactly. Of 840 documents, 802 replay to a final version
and 38 fall back; 288 carry the shell warning; 427 edits target files never
created in their conversation, the 413 plus 14 of spec §3.

The heading test changed shape. Fencing keeps a quoted `## [3] Human` inside
the fence, but `cctx`'s read-back still sees it, and declines to measure that
transcript's alternation rather than misreading it. The test checks that, and
spec §7.3 says so.

## Phase 4: config, link lists and selection

- `config.ts`: walk-up discovery of `.caitx.yaml`, defaults, unknown keys an
  error naming the key. This follows `cctx`'s `config.ts` but is not imported
  from it, because `cctx`'s config names and keys are its own.
- `linklist.ts` and `select.ts` (§5.1–§5.3).
- `caitx list`, built straight after selection rather than left to phase 6,
  because link lists are kept current with `list --since` (§11.2).

**Tests:**

- A link list collects uuids from chat URLs, bare uuids and prose; skips
  comments; collapses duplicates; and skips and reports a project uuid.
- A uuid that is neither in the export nor on disk fails the run before
  anything is written, with exit code 2.
- A uuid on disk but not in the export is carried and reported.
- A conversation in two projects' lists is an error.
- A conversation both in a project and in `conversations` is selected once,
  under the project.
- A title selector matching none or several conversations is an error; one
  matching exactly one prints the uuid it resolved to.
- `exclude` wins over every selector.
- `list --since`, `--unselected` and `--format list` filter and print as
  §11.2 says.

## Phase 5: writing and the index

`conversation.ts`, `render/index.ts`, `extract.ts`. Writing goes through the
`cctx` library: `sessionFilename`, `renderTranscript` with `source` and
`fields`, `writeIfChanged`, `pruneRenamed`, `pruneExcluded` and
`readTranscripts`, which runs before anything is written.

**Tests**, in a temp directory:

- **The headline invariant:** a second run over the same export writes zero
  files.
- **The stronger one:** a newer fixture export, in which only a
  conversation's `updated_at` moved, writes nothing for that conversation
  (§9).
- A conversation that gained a branch is rewritten. *Corrected while
  building:* this plan first grouped a gained branch with the zero-write
  case, but a branch changes `branches_dropped`, and a regenerated reply is
  newer, so it becomes the rendered branch. Both are real changes.
- A renamed conversation's old file is deleted and reported.
- An excluded conversation's transcript is deleted and reported.
- A deselected conversation's transcript is kept, kept in the index, and
  reported with a pointer to `exclude`.
- A conversation missing from a newer export keeps its transcript and its
  index row, with its project read back from `CarriedTranscript.frontmatter`.
- An untitled conversation takes its first human line, truncated at a word
  boundary, with `title_derived: true`.
- The account uuid appears nowhere in the output.
- `--dry-run` writes nothing.

## Phase 6: CLI and packaging

- `extract`, `list`, `probe` and `init` (§11), exit codes `0`, `1` and `2`,
  warnings on stderr, `--json` on stdout.
- README: install, the capture workflow (ask Claude in the project, paste the
  list, compare the count with the project page), configuration, and the
  limits stated plainly: one branch, markers instead of images, and nothing
  CI can do about drift.
- A `probe` snapshot test over the fixture export, so changed handling fails
  a test (§14).
- `npm pack`, installed into a scratch project, before the first release.
  That is the check that caught `cctx`'s symlinked-binary bug, which the tests
  and the build both passed.
- **The first publish may have to be manual.** As understood when this was
  written, npm trusted publishing can only be configured for a package that
  already exists, so `0.1.0` might need a token-based publish before
  `release.yml` can take over. Confirm against npm's documentation at the
  time rather than relying on this note.

## Phase 7: acceptance

### 7.1 `protocol-era`'s ten conversations

Write a `.caitx.yaml` naming the ten conversations from
`protocol-era/apps/setting/scripts/allowlist.json`, extract them into a
scratch directory, and diff the result against
`apps/setting/sources/*.md`. Expected differences:

- Frontmatter gains `source`, `url` and, where they apply, `branches_dropped`
  and `title_derived`.
- Tool payloads, which the old extractor kept as JSON, are stripped, except
  documents, which render as documents.
- `61b697dd` loses whatever its abandoned branch contributed (spec §5.1).
- **Turn numbers move** wherever coalescing or dropped empty messages apply.

That last difference is a decision, not just an observation. `protocol-era`
cites turn numbers in its content: 254 citations shaped like "Turn 149" or
"Turns 215–229", across 41 files, counted on 2026-10-18. Its
`docs/provenance.md` describes the practice.
Replacing its transcripts would silently re-point every citation into a
renumbered transcript. So this phase measures the renumbering transcript by
transcript, and whether `protocol-era` moves to `caitx` at all is decided
afterwards, with that measurement in hand. If it does, the move carries a
mapping from old turn numbers to new ones, and the citations are updated
with it.

### 7.2 The project with about a hundred conversations

Capture its list by asking Claude in the project. Extract it, and compare the
resolved count `caitx` prints with the number on the project page. This is
the real test of §5.2's design: whether pasting, checking and counting is a
workable way to select a hundred conversations.

**Done when:** both runs finish with only expected differences, a second run
writes nothing, and the README's capture workflow is the one actually used in
7.2.

## Risks

**Schema drift**, as in `cctx`. The export format is undocumented, and it has
already changed once in the life of `protocol-era`'s extractor: a sharded
directory replaced a single zip. Mitigation is the same: `probe` as a command,
a snapshot over fixtures, and unknown types reported rather than assumed
absent.

**Memory.** `fflate` unzips the 211 MB entry into memory, then it is decoded
to a string and parsed. At its peak that is the compressed buffer, the
decompressed buffer, the string and the parsed objects at once, and the
string can be released only after the parse. Phase 1 measures the peak against
the real export. If it approaches Node's default heap, a streaming parser
moves forward from §15.

**Document placement is intricate**, and a placement bug looks like a correct
transcript. Phase 3 stands alone for this reason, its tests name each rule,
and its "done" criterion checks counts against the real export rather than
the fixture alone.

**Renumbering `protocol-era`'s cited turns** (phase 7.1). This is a cost to
that project, not a bug in this one, and it is why that migration is a
decision taken with measurements rather than a default.

**A missing conversation in a pasted list goes unnoticed** if the resolved
count is never compared with the project page. Nothing in the export can
catch it (§5.2). The mitigation is procedural: the count is printed on every
run, and the README's workflow includes the comparison.

## Sequencing summary

```
0 scaffold ──> 1 reader + probe ──> 2 conversation ──> 3 documents ──┐
                                └─> 4 config + select ───────────────┴──> 5 write ──> 6 CLI + package ──> 7 acceptance
```

Phase 4 depends only on phase 1 and can be built alongside phases 2 and 3.
Phase 5 does not begin until phases 3 and 4 are both done.
