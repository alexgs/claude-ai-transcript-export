#!/usr/bin/env node
import { existsSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { readTranscripts, UsageError } from '@alexgsdev/claude-code-transcript-export';
import { join, relative, resolve } from 'node:path';
import type { ContentPolicy } from '../types.js';
import { readExport, type ExportInput } from '../input.js';
import { formatProbe, probeConversations } from '../probe.js';
import {
  CONFIG_NAMES,
  loadConfig,
  loadConfigFile,
  type ResolvedConfig,
} from '../config.js';
import { TEMPLATE } from './init.js';
import { parseArgs, type Options } from './args.js';
import { formatRows, listRows } from './list.js';
import { extract, resolveSelection, type ExtractSummary } from '../extract.js';

/**
 * The package's own version, read rather than duplicated.
 *
 * As in cctx, whose version literal drifted the first time the package was
 * bumped. `src/cli/` and `dist/cli/` are both two levels below package.json,
 * so the relative path resolves the same from either.
 */
export const VERSION: string = (
  createRequire(import.meta.url)('../../package.json') as { version: string }
).version;

const USAGE = `caitx — extract claude.ai conversations into markdown transcripts.

Usage:
  caitx [extract] <export>   Write transcripts for the selected conversations
  caitx list <export>        Show every conversation and whether it is selected
  caitx probe <export>       Report the observed export schema
  caitx init                 Write a .caitx.yaml here

<export> is an export directory as downloaded, one of its zips, or a bare
conversations file.

Options:
  --config <path>            Use exactly this config file
  --json                     Emit the result as JSON

extract:
  --out <path>               Override the output directory
  --keep-tools               Keep every tool call and result, as JSON
  --keep-thinking            Keep thinking blocks
  --inline-attachments       Include attachments' extracted text
  --dry-run                  Report what would happen, write nothing

list:
  --since <YYYY-MM-DD>       Only conversations created on or after a date
  --unselected               Only conversations nothing selects
  --format list              One uuid per line, ready for a link list
  -h, --help                 This message
  -v, --version              Print the version

`;

export function main(
  argv: string[],
  io: { stdout: NodeJS.WritableStream; stderr: NodeJS.WritableStream; cwd: string },
): number {
  try {
    const options = parseArgs(argv);

    if (options.command === 'help') {
      io.stdout.write(`${USAGE}\n`);
      return 0;
    }
    if (options.command === 'version') {
      io.stdout.write(`${VERSION}\n`);
      return 0;
    }

    if (options.command === 'probe') {
      const input = readExport(options.input as string);
      // stderr, so `--json` output stays parseable.
      for (const warning of input.warnings)
        io.stderr.write(`caitx: warning: ${warning}\n`);
      const report = probeConversations(input.conversations);

      if (options.json) {
        io.stdout.write(
          `${JSON.stringify({ export: describe(input), ...report }, null, 2)}\n`,
        );
      } else {
        io.stdout.write(`export: ${input.path}\n`);
        io.stdout.write(
          `form: ${input.form}${input.createdAt ? `, created ${input.createdAt}` : ''}\n`,
        );
        io.stdout.write(`projects: ${input.projectUuids.length}\n\n`);
        io.stdout.write(`${formatProbe(report)}\n`);
      }
      return 0;
    }

    if (options.command === 'init') {
      // Either name, not just the one about to be written: a fresh
      // .caitx.yaml beside a .caitx.json would silently take over from it.
      const existing = CONFIG_NAMES.map((name) => join(io.cwd, name)).find((p) =>
        existsSync(p),
      );
      if (existing !== undefined) {
        io.stderr.write(`caitx: ${existing} already exists.\n`);
        return 1;
      }
      const path = join(io.cwd, CONFIG_NAMES[0]);
      writeFileSync(path, TEMPLATE);
      io.stdout.write(`wrote ${path}\nproject root: ${io.cwd}\n`);
      return 0;
    }
    if (options.command === 'list') return runList(options, io);
    if (options.command === 'extract') return runExtract(options, io);

    throw new Error(`unhandled command ${options.command}`);
  } catch (cause) {
    if (cause instanceof UsageError) {
      io.stderr.write(`caitx: ${cause.message}\n`);
      return 2;
    }
    io.stderr.write(
      `caitx: ${cause instanceof Error ? (cause.stack ?? cause.message) : String(cause)}\n`,
    );
    return 1;
  }
}

/** The config `--config` names, or the nearest one; null when there is none. */
function findResolved(options: Options, cwd: string): ResolvedConfig | null {
  return options.config !== undefined
    ? loadConfigFile(options.config)
    : loadConfig(cwd);
}

function runList(
  options: Options,
  io: { stdout: NodeJS.WritableStream; stderr: NodeJS.WritableStream; cwd: string },
): number {
  const input = readExport(options.input as string);
  for (const warning of input.warnings) io.stderr.write(`caitx: warning: ${warning}\n`);

  const resolved = findResolved(options, io.cwd);
  const selection =
    resolved === null
      ? null
      : resolveSelection(
          input,
          resolved,
          readTranscripts(resolve(resolved.root, resolved.config.out)),
        );
  if (resolved === null) {
    io.stderr.write('caitx: no .caitx.yaml here or above, so nothing is selected.\n');
  } else {
    io.stderr.write(`caitx: project root: ${resolved.root}\n`);
    for (const p of selection?.projects ?? []) {
      io.stderr.write(
        `caitx: ${p.name}: ${p.total} conversations (${p.inExport} in this export, ${p.carried} carried)\n`,
      );
    }
    for (const t of selection?.titles ?? []) {
      io.stderr.write(
        `caitx: title ${JSON.stringify(t.title)} is ${t.uuid}; name it by uuid, since titles change.\n`,
      );
    }
  }

  let rows = listRows(
    input.conversations,
    selection,
    new Set(resolved?.config.exclude ?? []),
  );
  if (options.since !== undefined) {
    const since = options.since;
    rows = rows.filter((r) => r.created >= since);
  }
  if (options.unselected) rows = rows.filter((r) => r.status === 'not selected');

  if (options.json) io.stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
  else if (options.format === 'list')
    io.stdout.write(rows.map((r) => `${r.uuid}\n`).join(''));
  else if (rows.length > 0) io.stdout.write(`${formatRows(rows)}\n`);
  return 0;
}

/** Today, local: the only clock read in the package lives here. */
function todayLocal(now = new Date()): string {
  const month = `${now.getMonth() + 1}`.padStart(2, '0');
  const day = `${now.getDate()}`.padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

function runExtract(
  options: Options,
  io: { stdout: NodeJS.WritableStream; stderr: NodeJS.WritableStream; cwd: string },
): number {
  const resolved = findResolved(options, io.cwd);
  if (resolved === null) {
    throw new UsageError(
      `no .caitx.yaml in ${io.cwd} or any parent directory. ` +
        'Write one (see the README) or pass --config <path>.',
    );
  }
  const input = readExport(options.input as string);
  for (const warning of input.warnings) io.stderr.write(`caitx: warning: ${warning}\n`);

  const policy: Partial<ContentPolicy> = {};
  if (options.keepTools) policy.tools = 'keep';
  if (options.keepThinking) policy.thinking = 'keep';
  if (options.inlineAttachments) policy.attachments = 'inline';

  const summary = extract({
    input,
    resolved,
    today: todayLocal(),
    dryRun: options.dryRun,
    policy,
    ...(options.out !== undefined ? { out: options.out } : {}),
  });

  for (const t of summary.titles) {
    io.stderr.write(
      `caitx: title ${JSON.stringify(t.title)} is ${t.uuid}; name it by uuid, since titles change.\n`,
    );
  }
  if (options.json) {
    io.stdout.write(
      `${JSON.stringify({ export: describe(input), ...summary }, null, 2)}\n`,
    );
  } else {
    if (options.dryRun) io.stdout.write('dry run: nothing written\n');
    reportExtract(summary, input, io.stdout);
  }
  return 0;
}

function reportExtract(
  summary: ExtractSummary,
  input: ExportInput,
  out: NodeJS.WritableStream,
): void {
  const rel = relative(summary.root, summary.outDir) || '.';
  out.write(`project root: ${summary.root}\n`);
  out.write(
    `export: ${input.path}${input.createdAt ? ` (created ${input.createdAt})` : ''}\n`,
  );
  out.write(`output: ${rel}\n`);
  // Printed every run: nothing in the export can catch a link list that is
  // missing conversations, so this count, compared once with the project
  // page, is the only check (§5.2).
  for (const p of summary.projects) {
    out.write(
      `${p.name}: ${p.total} conversations (${p.inExport} in this export, ${p.carried} carried)\n`,
    );
  }
  for (const uuid of summary.skippedProjectUuids) {
    out.write(`skipped a project uuid in a link list: ${uuid}\n`);
  }
  out.write(
    `conversations: ${summary.conversations}, written: ${summary.written}, ` +
      `unchanged: ${summary.unchanged}, turns: ${summary.turns}, ` +
      `branches dropped: ${summary.branchesDropped}\n`,
  );
  if (summary.carried.length > 0) {
    out.write(
      `carried forward: ${summary.carried.length} transcript(s) kept in the index ` +
        'that this export does not regenerate\n',
    );
  }
  for (const d of summary.deselected) {
    out.write(
      `deselected, kept: ${d.filename}. Its conversation is no longer selected. ` +
        `To delete it, add ${d.id} to exclude.\n`,
    );
  }
  for (const s of summary.skipped)
    out.write(`skipped (${s.reason}): ${s.title} [${s.id.slice(0, 8)}]\n`);
  for (const r of summary.removed) out.write(`removed (${r.reason}): ${r.name}\n`);
  for (const f of summary.documentsFellBack) {
    out.write(
      `documents shown as created plus edits, since their edits did not all apply, ` +
        `in ${f.id.slice(0, 8)}: ${f.documents.join(', ')}\n`,
    );
  }
}

/** The export's identity, for `--json`, without its conversations. */
function describe(input: ExportInput) {
  return {
    path: input.path,
    form: input.form,
    createdAt: input.createdAt,
    projects: input.projectUuids.length,
    warnings: input.warnings,
  };
}

/**
 * Run only when this file is the entry point.
 *
 * Copied from cctx, where both halves were wrong first: an import of `main`
 * must not run the CLI as a side effect, and an installed binary is invoked
 * through the `node_modules/.bin` **symlink**, so `process.argv[1]` has to be
 * resolved before it is compared with `import.meta.url`. Without that, the
 * installed `caitx` silently does nothing.
 */
/* c8 ignore start */
const entry = process.argv[1];
const entryUrl =
  entry === undefined ? undefined : pathToFileURL(realpathSync(entry)).href;
if (entryUrl !== undefined && import.meta.url === entryUrl) {
  process.exitCode = main(process.argv.slice(2), {
    stdout: process.stdout,
    stderr: process.stderr,
    cwd: process.cwd(),
  });
}
/* c8 ignore stop */
