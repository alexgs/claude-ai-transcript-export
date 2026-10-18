# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`caitx` reads a claude.ai account export and writes selected conversations as
markdown transcripts into a project's repository. Published as
`@alexgsdev/claude-ai-transcript-export`; the binary is `caitx`.

It is the sibling of `cctx` (`@alexgsdev/claude-code-transcript-export`), which
does the same for Claude Code's local logs, and depends on that package's
library for rendering, writing and reading transcripts back. Keep
claude.ai-export logic here and out of `cctx`; `cctx`'s spec 05 says why.

The design is in `docs/specs/01-brief.md` (decisions and the observed export
format) and `docs/specs/02-specification.md` (the rules). The order of work is
`docs/plans/01-implementation-plan.md`. **Read the relevant section before
changing behaviour.**

## Architecture

A pipeline, pure in the middle, as in `cctx`:

```
input.ts         an export in any of three forms           (I/O)
tree.ts          a conversation's tree -> one branch        (pure)
blocks.ts        content blocks -> markdown, markers        (pure)
documents.ts     replay create_file/str_replace/artifacts   (pure, two passes)
turns.ts         a branch -> turns, then documents placed   (pure)
conversation.ts  -> a TranscriptSession for cctx's library  (pure)
linklist.ts      pasted link lists, read generously         (pure)
select.ts        which conversations, checked strictly      (pure)
render/index.ts  index.md                                   (pure)
extract.ts       the run: read disk, select, write via cctx (I/O)
probe.ts         the schema report                          (pure)
cli/             arguments, reporting                       (I/O, clock)
```

The document model needs turn numbers that do not exist until turns are
built, so `blocks.ts` leaves private-use-character tokens where document
operations sit and `turns.ts` resolves them afterwards. A token left
unresolved throws.

`test/snapshot.test.ts` renders `test/fixtures/export/rich.json`, which
exercises every block type and document rule plus one unknown block type.
Update its snapshot deliberately when handling changes.

## Commands

```sh
npm test                          # full suite
npx vitest run test/cli.test.ts   # one file
npm run typecheck
npm run format:check              # CI runs this; `npm run format` to fix
npm run build                     # emits dist/ with declarations
```

Node is pinned to 22 via Volta, as in `cctx`.

## Invariants

**Nothing below `cli/` reads the clock, the environment, or the home
directory.** Where a function needs one, it takes it as a parameter. This is
what lets the suite run in CI.

**A real export is never checked in, and tests never read one.** An export
holds every conversation in the account. Tests build a fixture export into a
temp directory from the JSON in `test/fixtures/export/` (`test/helpers.ts`).

**`light_metadata-*.zip` is never opened.** It holds login history and nothing
a transcript needs.

## Testing against reality

CI has no real export, so it cannot detect the export format changing. Before
trusting a change to parsing, run `caitx probe` against a real export locally,
and `npm pack` plus an install into a scratch project before a release.

## Conventions

- Prose is excluded from Prettier (`docs/`, `*.md` in `.prettierignore`).
- Comments carry the *why*, at some length, where a decision is not obvious
  from the code.

## Releases

As in `cctx`. Work lands on `develop`; `main` is what has been released, and
every merge to `main` publishes.

1. Each PR to `develop` that changes `src/`, `package.json` or
   `tsconfig.build.json` adds a changeset (`npm run changeset`), or carries the
   `skip-changeset` label when nobody installing the package would notice.
2. To release, branch from `develop`, run `npm run release:version`, commit,
   and PR that to `develop`.
3. PR `develop` to `main`. `release-guard.yml` checks the version bump.
4. On merge, `release.yml` publishes and pushes the tag `v<version>`. Do not
   tag by hand.

`release.yml` publishes via npm trusted publishing, which is bound to the
filename, so don't rename it. The first publish may have to be done by hand
(plan, phase 6).
