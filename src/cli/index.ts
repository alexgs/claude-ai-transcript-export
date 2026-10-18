#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { UsageError } from '@alexgsdev/claude-code-transcript-export';
import { readExport, type ExportInput } from '../input.js';
import { formatProbe, probeConversations } from '../probe.js';
import { parseArgs } from './args.js';

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
  --json                     Emit the result as JSON
  -h, --help                 This message
  -v, --version              Print the version

Implemented so far: probe.`;

export function main(
  argv: string[],
  io: { stdout: NodeJS.WritableStream; stderr: NodeJS.WritableStream },
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
  });
}
/* c8 ignore stop */
