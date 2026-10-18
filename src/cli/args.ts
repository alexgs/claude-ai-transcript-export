import { UsageError } from '@alexgsdev/claude-code-transcript-export';

export type Command = 'extract' | 'list' | 'probe' | 'init' | 'help' | 'version';

export interface Options {
  command: Command;
  /** The export, for every command but `init`, `help` and `version`. */
  input?: string;
  json: boolean;
}

const COMMANDS = new Set<string>(['extract', 'list', 'probe', 'init']);

/**
 * argv to options. Grows with each phase; the rule that holds throughout is
 * that an unrecognized argument is an error naming it, never ignored, as in
 * cctx.
 */
export function parseArgs(argv: string[]): Options {
  const options: Options = { command: 'extract', json: false };
  const positionals: string[] = [];

  for (const arg of argv) {
    if (arg === '-h' || arg === '--help') return { ...options, command: 'help' };
    if (arg === '-v' || arg === '--version') return { ...options, command: 'version' };
    if (arg === '--json') {
      options.json = true;
      continue;
    }
    if (arg.startsWith('-')) throw new UsageError(`unrecognized argument \`${arg}\`.`);
    positionals.push(arg);
  }

  if (positionals.length === 0) return { ...options, command: 'help' };

  let rest = positionals;
  if (COMMANDS.has(positionals[0] as string)) {
    options.command = positionals[0] as Command;
    rest = positionals.slice(1);
  } else if (!/[/.]/.test(positionals[0] as string)) {
    // Not a command, and does not look like a path either: almost certainly a
    // mistyped command rather than an export called `prob`.
    throw new UsageError(
      `unknown command \`${positionals[0]}\`. Run \`caitx --help\`.`,
    );
  }

  if (options.command === 'init') {
    if (rest.length > 0) throw new UsageError('`init` takes no export.');
    return options;
  }

  if (rest.length !== 1) {
    throw new UsageError(
      rest.length === 0
        ? `\`${options.command}\` needs the path to an export.`
        : `expected one export, got ${rest.length}.`,
    );
  }
  options.input = rest[0];
  return options;
}
