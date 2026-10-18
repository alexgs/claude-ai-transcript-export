#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { UsageError } from '@alexgsdev/claude-code-transcript-export';
import { readExport, type ExportInput } from '../input.js';
import { formatProbe, probeConversations } from '../probe.js';
import { loadConfig, loadConfigFile, type ResolvedConfig } from '../config.js';
import { parseArgs, type Options } from './args.js';
import { formatRows, listRows, resolveSelection } from './list.js';

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

list:
  --since <YYYY-MM-DD>       Only conversations created on or after a date
  --unselected               Only conversations nothing selects
  --format list              One uuid per line, ready for a link list
  -h, --help                 This message
  -v, --version              Print the version

Implemented so far: probe, list.`;

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

    if (options.command === 'list') return runList(options, io);

    io.stderr.write(`caitx: \`${options.command}\` is not implemented yet.\n`);
    return 1;
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
  const selection = resolved === null ? null : resolveSelection(input, resolved);
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
