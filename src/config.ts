import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { UsageError } from '@alexgsdev/claude-code-transcript-export';
import { PRESERVED_TOOLS } from './blocks.js';
import type {
  AttachmentPolicy,
  ContentPolicy,
  ThinkingPolicy,
  ToolPolicy,
} from './types.js';

/** Config filenames, in precedence order. First match wins. */
export const CONFIG_NAMES = ['.caitx.yaml', '.caitx.json'] as const;

/** A claude.ai project, fed by a link list (specification §5.2). */
export interface ProjectConfig {
  /** Recorded in frontmatter as `project`. Required, and unique. */
  name: string;
  /** Recorded in frontmatter as `project_uuid`. */
  uuid?: string;
  /** The link list, relative to the config file. */
  list: string;
  note?: string;
}

/** One conversation, named by uuid or, discouraged, by title (§5.3). */
export interface ConversationEntry {
  uuid?: string;
  title?: string;
  note?: string;
}

export interface IndexConfig {
  enabled: boolean;
  preamble: string | null;
  listExcluded: 'count' | 'ids' | 'none';
}

export interface Config {
  out: string;
  projects: ProjectConfig[];
  conversations: ConversationEntry[];
  exclude: string[];
  tools: ToolPolicy;
  thinking: ThinkingPolicy;
  attachments: AttachmentPolicy;
  /** Tools kept as JSON under `tools: strip` (§7.2). */
  keepTools: string[];
  skipEmpty: boolean;
  index: IndexConfig;
}

export const DEFAULT_CONFIG: Config = {
  out: 'docs/conversations',
  projects: [],
  conversations: [],
  exclude: [],
  tools: 'strip',
  thinking: 'drop',
  attachments: 'marker',
  keepTools: [],
  skipEmpty: true,
  index: { enabled: true, preamble: null, listExcluded: 'count' },
};

export interface ResolvedConfig {
  /** The directory holding the config file. This is the project root. */
  root: string;
  configPath: string;
  config: Config;
}

/**
 * The nearest config file at or above `from`, as in cctx: the directory
 * containing it is the project root, and every run prints the root it
 * resolved, since a config in an unexpected parent is walk-up discovery's one
 * failure mode.
 */
export function findConfig(from: string): string | null {
  let dir = resolve(from);
  for (;;) {
    for (const name of CONFIG_NAMES) {
      const candidate = join(dir, name);
      if (existsSync(candidate)) return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

const isMapping = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const ENUMS = {
  tools: ['strip', 'keep'],
  thinking: ['drop', 'keep'],
  attachments: ['marker', 'inline'],
} as const;

function assertEnum(key: keyof typeof ENUMS, value: unknown): void {
  const allowed: readonly string[] = ENUMS[key];
  if (typeof value !== 'string' || !allowed.includes(value)) {
    throw new UsageError(
      `\`${key}\` must be one of ${allowed.join(' | ')}, got ${JSON.stringify(value)}.`,
    );
  }
}

function optionalString(
  where: string,
  key: string,
  value: unknown,
): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.trim() === '') {
    throw new UsageError(`\`${where}.${key}\` must be a non-empty string.`);
  }
  return value;
}

function parseProjects(value: unknown): ProjectConfig[] {
  if (!Array.isArray(value)) throw new UsageError('`projects` must be a list.');
  const names = new Set<string>();
  return value.map((entry, i) => {
    const where = `projects[${i}]`;
    if (!isMapping(entry)) throw new UsageError(`\`${where}\` must be a mapping.`);
    for (const key of Object.keys(entry)) {
      if (!['name', 'uuid', 'list', 'note'].includes(key)) {
        throw new UsageError(`unknown config key \`${where}.${key}\`.`);
      }
    }
    const name = optionalString(where, 'name', entry.name);
    const list = optionalString(where, 'list', entry.list);
    if (name === undefined) throw new UsageError(`\`${where}\` needs a \`name\`.`);
    if (list === undefined)
      throw new UsageError(`\`${where}\` (${name}) needs a \`list\`.`);
    // The name is how a transcript says which project it is from, so two
    // projects sharing one would be indistinguishable in every transcript.
    if (names.has(name)) throw new UsageError(`two projects are named \`${name}\`.`);
    names.add(name);
    const project: ProjectConfig = { name, list };
    const uuid = optionalString(where, 'uuid', entry.uuid);
    const note = optionalString(where, 'note', entry.note);
    if (uuid !== undefined) project.uuid = uuid.toLowerCase();
    if (note !== undefined) project.note = note;
    return project;
  });
}

function parseConversationEntries(value: unknown): ConversationEntry[] {
  if (!Array.isArray(value)) throw new UsageError('`conversations` must be a list.');
  return value.map((entry, i) => {
    const where = `conversations[${i}]`;
    if (!isMapping(entry)) throw new UsageError(`\`${where}\` must be a mapping.`);
    for (const key of Object.keys(entry)) {
      if (!['uuid', 'title', 'note'].includes(key)) {
        throw new UsageError(`unknown config key \`${where}.${key}\`.`);
      }
    }
    const uuid = optionalString(where, 'uuid', entry.uuid);
    const title = optionalString(where, 'title', entry.title);
    if ((uuid === undefined) === (title === undefined)) {
      throw new UsageError(`\`${where}\` needs exactly one of \`uuid\` and \`title\`.`);
    }
    const out: ConversationEntry = {};
    if (uuid !== undefined) out.uuid = uuid.toLowerCase();
    if (title !== undefined) out.title = title;
    const note = optionalString(where, 'note', entry.note);
    if (note !== undefined) out.note = note;
    return out;
  });
}

/**
 * A parsed config object over the defaults.
 *
 * Unknown keys are an error naming the key, never a silent ignore, as in
 * cctx: a typo in `exclude` that quietly does nothing is how a conversation
 * meant to be withheld ends up committed.
 */
export function mergeConfig(raw: unknown): Config {
  const config: Config = {
    ...DEFAULT_CONFIG,
    projects: [],
    conversations: [],
    exclude: [],
    keepTools: [],
    index: { ...DEFAULT_CONFIG.index },
  };
  if (raw === null || raw === undefined) return config;
  if (!isMapping(raw)) throw new UsageError('config must be a mapping of options.');

  for (const [key, value] of Object.entries(raw)) {
    if (value === undefined) continue;
    switch (key) {
      case 'out':
        if (typeof value !== 'string' || value === '') {
          throw new UsageError('`out` must be a non-empty path.');
        }
        config.out = value;
        break;
      case 'projects':
        config.projects = parseProjects(value);
        break;
      case 'conversations':
        config.conversations = parseConversationEntries(value);
        break;
      case 'exclude':
        if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) {
          throw new UsageError('`exclude` must be a list of conversation uuids.');
        }
        config.exclude = (value as string[]).map((v) => v.toLowerCase());
        break;
      case 'tools':
      case 'thinking':
      case 'attachments':
        assertEnum(key, value);
        config[key] = value as never;
        break;
      case 'keepTools': {
        if (
          !Array.isArray(value) ||
          value.some((v) => typeof v !== 'string' || v === '')
        ) {
          throw new UsageError('`keepTools` must be a list of tool names.');
        }
        const preserved = (value as string[]).filter((v) => PRESERVED_TOOLS.has(v));
        if (preserved.length > 0) {
          throw new UsageError(
            `\`keepTools\` names ${preserved.join(', ')}, which ${preserved.length === 1 ? 'is' : 'are'} ` +
              'already preserved in readable form; listing it would render it twice. ' +
              'Use `tools: keep` to see every call as JSON.',
          );
        }
        config.keepTools = [...new Set(value as string[])];
        break;
      }
      case 'skipEmpty':
        if (typeof value !== 'boolean')
          throw new UsageError('`skipEmpty` must be true or false.');
        config.skipEmpty = value;
        break;
      case 'index': {
        if (!isMapping(value)) throw new UsageError('`index` must be a mapping.');
        for (const [k, v] of Object.entries(value)) {
          if (k === 'enabled') {
            if (typeof v !== 'boolean')
              throw new UsageError('`index.enabled` must be true or false.');
            config.index.enabled = v;
          } else if (k === 'preamble') {
            if (v !== null && typeof v !== 'string') {
              throw new UsageError('`index.preamble` must be a string or null.');
            }
            config.index.preamble = v;
          } else if (k === 'listExcluded') {
            if (v !== 'count' && v !== 'ids' && v !== 'none') {
              throw new UsageError(
                '`index.listExcluded` must be one of count | ids | none.',
              );
            }
            config.index.listExcluded = v;
          } else {
            throw new UsageError(`unknown config key \`index.${k}\`.`);
          }
        }
        break;
      }
      default:
        throw new UsageError(`unknown config key \`${key}\`.`);
    }
  }
  return config;
}

/** A config file's contents, by extension. */
export function parseConfigFile(path: string, contents: string): Config {
  let raw: unknown;
  try {
    raw = path.endsWith('.json') ? JSON.parse(contents) : parseYaml(contents);
  } catch (cause) {
    throw new UsageError(
      `${path} is not valid ${path.endsWith('.json') ? 'JSON' : 'YAML'}: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
    );
  }
  return mergeConfig(raw);
}

/**
 * Exactly the file at `path`, for `--config`. No discovery: cctx's `--config`
 * once handed the file's directory to discovery, which then read whichever
 * standard name it found instead of the file named.
 */
export function loadConfigFile(path: string): ResolvedConfig {
  const configPath = resolve(path);
  if (!existsSync(configPath))
    throw new UsageError(`no such config file: ${configPath}`);
  return {
    root: dirname(configPath),
    configPath,
    config: parseConfigFile(configPath, readFileSync(configPath, 'utf8')),
  };
}

/** The nearest config at or above `from`, or null when there is none. */
export function loadConfig(from: string): ResolvedConfig | null {
  const configPath = findConfig(from);
  return configPath === null ? null : loadConfigFile(configPath);
}

/** The content policy a config implies. */
export function contentPolicy(config: Config): ContentPolicy {
  return {
    tools: config.tools,
    thinking: config.thinking,
    attachments: config.attachments,
    keepTools: config.keepTools,
  };
}
