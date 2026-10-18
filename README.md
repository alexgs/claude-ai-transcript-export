# Claude.ai Transcript Export (caitx)

Extract selected conversations from a claude.ai account export into readable,
committable markdown transcripts.

A claude.ai export is a snapshot of an account's whole history, and the next
one is missing every conversation deleted since. `caitx` copies the
conversations a project cares about into its repository, where they stay.

It is the sibling of
[`cctx`](https://github.com/alexgs/claude-code-transcript-export), which does
the same for Claude Code's local session logs. It is built on that package's
library, and the two write transcripts in the same format.

## Install

```sh
npm install -g @alexgsdev/claude-ai-transcript-export
```

Installs the `caitx` command. Requires Node 22 or newer.

## Use

1. **Request an export** from claude.ai's settings and download every file it
   offers into one directory. That directory, as downloaded, is what `caitx`
   reads.

2. **Probe it.** Run this on every new export before trusting the rest:

   ```sh
   caitx probe ~/downloads/claude-archive-2026-10-18
   ```

   It reports counts of conversations, messages, block types, tool names and
   branches, plus anything this version does not handle, and writes nothing.
   It never prints a value from a conversation, so its output is safe to paste
   into an issue.

3. **Write a config** at the root of the repository the transcripts go into:

   ```sh
   caitx init
   ```

4. **Say which conversations.** An export records no link between a
   conversation and its claude.ai project, so a project is given as a *link
   list*: a text file of its conversations' chat URLs or uuids. Either paste
   them from the project page, or ask Claude inside the project to list its
   conversations with their uuids, and paste the reply as it is. Anything on a
   line that is not a uuid is ignored.

   ```yaml
   projects:
     - name: Protocol Era
       list: conversations/protocol-era.txt
   ```

5. **Check the count.** `caitx list <export>` shows every conversation and its
   status, and prints how many each list resolved to. Compare that number with
   the project page once: nothing in an export can tell that a pasted list is
   missing conversations.

6. **Extract:**

   ```sh
   caitx ~/downloads/claude-archive-2026-10-18
   ```

   Output looks like this:

   ```
   docs/conversations/
     index.md
     2026-08-21--documenting-the-jump-limit--6370e5b1.md
   ```

To keep a project current after the first capture, run
`caitx list <export> --since <date> --unselected --format list` against each
new export and append what belongs.

### Commands

| | |
| --- | --- |
| `caitx [extract] <export>` | Write transcripts for the selected conversations |
| `caitx list <export>` | Every conversation, with its status |
| `caitx probe <export>` | Report the export's schema |
| `caitx init` | Write a starter `.caitx.yaml` here |

`<export>` is the export directory as downloaded, one of its zips, or a bare
`conversations.json`. Useful flags: `--config <path>`, `--out <path>`,
`--dry-run`, `--json`, `--keep-tools`, `--keep-thinking`,
`--inline-attachments`; for `list`, `--since`, `--unselected` and
`--format list`.

## How it decides things

**One branch per conversation.** Editing a prompt or regenerating a reply
starts a branch, and an export holds every branch interleaved. A transcript
follows the most recent one. `branches_dropped` in its frontmatter says how
many others there were.

**A turn is one exchange.** Consecutive assistant messages are joined, and a
human message with nothing in it is not a turn. Turn numbers are stable only
while these rules are, and the index says so.

**Tool calls are stripped, with three exceptions.** Each one holds something
authored that exists nowhere else:

- **Documents.** Files Claude made with `create_file`, and artifacts, appear
  in their final version. The edits are replayed, and the document is shown
  once, where it was last edited or presented, with a marker pointing to it
  from every earlier edit. If an edit does not apply, the document is shown
  as created, with each edit as a diff, and the run says so. If a shell
  command touched the file, the document says it may not be the final version.
- **Questions** Claude asked with its multiple-choice widget. The answer
  arrives as your next message, and is unreadable without the question.
- **Presented files**, as a marker naming them.

**No images.** An export holds no file bytes, so images, files and documents
you uploaded appear as markers with their names. Attachments get a marker
too; `attachments: inline` includes the text claude.ai extracted from them.

**Some projects need a stripped tool back.** `keepTools` in the config names
tools to keep as JSON while everything else stays as above. For example,
`keepTools: [conversation_search, web_search]` keeps what Claude retrieved
from earlier conversations and the web, which matters if the transcripts are
evidence of where an idea came from.

**Thinking is dropped**, as in `cctx`: a hypothesis the assistant talked
itself out of reads like a proposal when found out of context.

## Configuration

`.caitx.yaml`, at the project root; `caitx init` writes a commented starter.
Every key is optional. The full list is in
[the specification](docs/specs/02-specification.md) §5.

Selection is strict. A uuid in a link list that is neither in the export nor
a transcript already written fails the run before anything is written: it is
a typo, a copy from the wrong place, or a uuid a model made up. A
conversation in two projects' lists is an error. A conversation can also be
named by exact title, but titles change, and every run prints the uuid to
replace it with.

## What gets deleted

Almost nothing. The transcripts are the durable copy; the export is a
snapshot that will lose things.

- A transcript left behind by a **renamed** conversation is deleted.
- A conversation added to **`exclude`** has its transcript deleted.
- A conversation **missing from a newer export**, or **taken out of a link
  list**, keeps its transcript and its row in the index. Taking a line out of
  a pasted list is too easy to do by accident to be how a committed transcript
  is destroyed. Add the uuid to `exclude` to delete it.

Every deletion is printed. A rerun over the same export writes nothing.

## On schema drift

The export format is undocumented and has already changed at least once: a
single zip became a directory of parts. `caitx probe` names anything this
version does not handle, and the test suite snapshots a synthetic export, but
neither can notice claude.ai changing its format. Only running `probe` on a
real export can.

## Library

The CLI is a thin wrapper, and the library is published with it: reading an
export (`readExport`), choosing a branch (`chooseBranch`), building turns
(`buildTurns`), selecting (`select`), and the whole run (`extract`). Every
export has a doc comment. Nothing in the library reads the clock, the
environment or the home directory on its own.

## Design

[The brief](docs/specs/01-brief.md) records the decisions and the observed
export format; [the specification](docs/specs/02-specification.md) has the
rules; [the implementation plan](docs/plans/01-implementation-plan.md) the
order they were built in.

## Releasing

Work lands on `develop`; `main` is what has been released. Every merge to
`main` publishes to npm. Changes are recorded as they are made with
[Changesets](https://changesets.dev) and collected into `CHANGELOG.md` at
release time. The process is the same as `cctx`'s.

**While developing.** A PR to `develop` that changes `src/`, `package.json` or
`tsconfig.build.json` must add a changeset:

```sh
npm run changeset
```

CI fails without one. Label the PR `skip-changeset` if nothing a user of the
package would notice has changed.

**To release:**

1. Branch from an up-to-date `develop` and apply the pending changesets:

   ```sh
   git switch develop && git pull
   git switch -c release-<version>
   npm run release:version
   ```

   This deletes the changesets, bumps the version in `package.json` and
   `package-lock.json`, and prepends an entry to `CHANGELOG.md`. Edit the
   entry if it reads badly, then commit everything it changed:
   `git add -A` rather than `git commit -a`, which skips new files. The first
   release lost its `CHANGELOG.md` that way, since the file did not exist
   until `release:version` created it.

2. Open a PR from the release branch to `develop` and merge it.

3. Open a PR from `develop` to `main`. CI fails unless the version went up,
   `CHANGELOG.md` has a section for it, the lockfile agrees, no changesets are
   left unapplied, and the tag does not exist yet.

4. Merge. `.github/workflows/release.yml` runs the full suite, publishes to
   npm with provenance, and pushes the tag `v<version>`.

Do not tag a release by hand. The workflow treats an existing tag as proof the
version is already published and skips the publish. If a release run fails
partway, re-run it from the Actions tab: it skips a publish that already
happened and only pushes the missing tag.

`release.yml` publishes through npm trusted publishing, with no token, and the
trust is bound to that filename, so don't rename it. It runs on Node 24 on
purpose: trusted publishing needs npm 11.5.1 or later, which no Node 22 release
bundles.

**The first release** could not go through the workflow alone, because
trusted publishing is configured on a package's npm settings page, and the
package did not exist on npm until it had been published once. This is how
it went, for anyone setting up the same arrangement; check npm's
documentation on trusted publishing before relying on it.

1. Steps 1 to 3 above for `0.1.0`, then the merge to `main`. The workflow's
   publish step failed, since nothing trusted it yet, and pushed no tag.
   (The release guard had to learn that `main` holds no `package.json` before
   a first release, and compares against `0.0.0` then.)
2. `0.1.0` was published by hand, with `npm publish --access public`, from
   the merged commit on `main`. It has no provenance statement, since
   provenance can only be generated in CI.
3. A trusted publisher was added on npmjs.com: GitHub Actions, repository
   `alexgs/claude-ai-transcript-export`, workflow `release.yml`.
4. Re-running the failed workflow found `0.1.0` already on npm, skipped the
   publish, and pushed the `v0.1.0` tag.
5. **That does not validate the trusted publisher.** npm marks a new one
   "pending validation" until a publish actually arrives through it, and
   gives a deadline, about two days, for that to happen. The tag-only rerun in
   step 4 publishes nothing, so a second release, `0.1.1`, went through the
   whole workflow to validate it.

Every release after that is steps 1 to 4 above.

## License

MIT
