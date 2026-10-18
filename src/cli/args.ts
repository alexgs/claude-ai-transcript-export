import { UsageError } from '@alexgsdev/claude-code-transcript-export';

export type Command = 'extract' | 'list' | 'probe' | 'init' | 'help' | 'version';

export interface Options {
  command: Command;
  /** The export, for every command but `init`, `help` and `version`. */
  input?: string;
  json: boolean;
  /** `--config <path>`: exactly this file, no discovery. */
  config?: string;
  /** `list --since <YYYY-MM-DD>`. */
  since?: string;
  /** `list --unselected`. */
  unselected: boolean;
  /** `list --format table|list`. */
  format: 'table' | 'list';
}

const COMMANDS = new Set<string>(['extract', 'list', 'probe', 'init']);

/**
 * argv to options. Grows with each phase; the rule that holds throughout is
 * that an unrecognized argument is an error naming it, never ignored, as in
 * cctx.
 */
export function parseArgs(argv: string[]): Options {
  const options: Options = {
    command: 'extract',
    json: false,
    unselected: false,
    format: 'table',
  };
  const positionals: string[] = [];

  const value = (flag: string, i: number): string => {
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('-'))
      throw new UsageError(`\`${flag}\` needs a value.`);
    return v;
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (arg === '-h' || arg === '--help') return { ...options, command: 'help' };
    if (arg === '-v' || arg === '--version') return { ...options, command: 'version' };
    if (arg === '--json') {
      options.json = true;
      continue;
    }
    if (arg === '--unselected') {
      options.unselected = true;
      continue;
    }
    if (arg === '--config') {
      options.config = value(arg, i++);
      continue;
    }
    if (arg === '--since') {
      const since = value(arg, i++);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(since)) {
        throw new UsageError(
          `\`--since\` takes a date as YYYY-MM-DD, got \`${since}\`.`,
        );
      }
      options.since = since;
      continue;
    }
    if (arg === '--format') {
      const format = value(arg, i++);
      if (format !== 'table' && format !== 'list') {
        throw new UsageError('`--format` is one of table | list.');
      }
      options.format = format;
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
