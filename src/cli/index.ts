#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

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

  -h, --help                 This message
  -v, --version              Print the version

Not implemented yet: every command above. See docs/plans/01-implementation-plan.md.`;

const COMMANDS = new Set(['extract', 'list', 'probe', 'init']);

export function main(
  argv: string[],
  io: { stdout: NodeJS.WritableStream; stderr: NodeJS.WritableStream },
): number {
  const [first] = argv;

  if (first === undefined || first === '-h' || first === '--help') {
    io.stdout.write(`${USAGE}\n`);
    return 0;
  }

  if (first === '-v' || first === '--version') {
    io.stdout.write(`${VERSION}\n`);
    return 0;
  }

  if (COMMANDS.has(first)) {
    io.stderr.write(`caitx: \`${first}\` is not implemented yet.\n`);
    return 1;
  }

  io.stderr.write(`caitx: unknown command \`${first}\`. Run \`caitx --help\`.\n`);
  return 2;
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
