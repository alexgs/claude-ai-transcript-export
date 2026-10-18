import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { strFromU8, unzipSync } from 'fflate';
import { UsageError } from '@alexgsdev/claude-code-transcript-export';
import type { RawConversation } from './types.js';

/** What was read, and from what. */
export interface ExportInput {
  path: string;
  /** Which of the three forms the path was (specification §4.1). */
  form: 'directory' | 'zip' | 'file';
  /** The manifest's `created_at`, when there is a manifest. */
  createdAt: string | null;
  conversations: RawConversation[];
  /**
   * Project uuids, read for one purpose: a link list containing one skips it
   * rather than failing on an unknown conversation (§5.2). Empty for the zip
   * and file forms, which carry no projects.
   */
  projectUuids: string[];
  /** Problems worth telling the user about that do not stop the run. */
  warnings: string[];
}

/** One entry of `manifest.json`'s `data_files`. */
interface ManifestPart {
  category: string;
  filename: string;
}

/**
 * Reads an export in any of its three forms.
 *
 * Only the `conversations` and `projects` categories are ever opened. The rest
 * of a real export is design chats, artifacts, memories, and
 * `light_metadata`, which holds login history (brief §2). Never opening them
 * is the only reliable way to never leak them.
 */
export function readExport(path: string): ExportInput {
  if (!existsSync(path)) throw new UsageError(`no such export: ${path}`);

  if (statSync(path).isDirectory()) return readDirectory(path);

  if (extname(path).toLowerCase() === '.zip') {
    return {
      path,
      form: 'zip',
      createdAt: null,
      conversations: readConversationsZip(path),
      projectUuids: [],
      warnings: [],
    };
  }

  return {
    path,
    form: 'file',
    createdAt: null,
    conversations: parseConversations(readFileSync(path, 'utf8'), path),
    projectUuids: [],
    warnings: [],
  };
}

function readDirectory(dir: string): ExportInput {
  const warnings: string[] = [];
  const manifestPath = join(dir, 'manifest.json');

  let parts: ManifestPart[];
  let createdAt: string | null = null;

  if (existsSync(manifestPath)) {
    const manifest = parseManifest(readFileSync(manifestPath, 'utf8'), manifestPath);
    parts = manifest.parts;
    createdAt = manifest.createdAt;
    if (manifest.version !== '1.0') {
      warnings.push(
        `${manifestPath} declares version ${JSON.stringify(manifest.version)}; ` +
          'this release was written against 1.0. Run `caitx probe` before trusting the output.',
      );
    }
  } else {
    // Readable, but nothing can confirm it is complete: a part lost in the
    // download looks exactly like an account with fewer conversations.
    parts = readdirSync(dir)
      .filter((name) => /^(conversations|projects)-\d+\.zip$/.test(name))
      .sort()
      .map((filename) => ({
        category: filename.replace(/-\d+\.zip$/, ''),
        filename,
      }));
    warnings.push(
      `${dir} has no manifest.json, so nothing confirms every part of the export ` +
        'is here. Read whatever conversations-*.zip files are present.',
    );
  }

  const conversationParts = parts.filter((p) => p.category === 'conversations');
  const projectParts = parts.filter((p) => p.category === 'projects');

  // A missing conversations part is an error, never a smaller export. The
  // check runs before anything is read, so a failure reads nothing.
  const missing = conversationParts.filter((p) => !existsSync(join(dir, p.filename)));
  if (missing.length > 0) {
    throw new UsageError(
      `the export's manifest lists ${missing.map((p) => p.filename).join(', ')}, ` +
        `which ${missing.length === 1 ? 'is' : 'are'} not in ${dir}. ` +
        'Download every part before extracting.',
    );
  }
  if (conversationParts.length === 0) {
    throw new UsageError(`${dir} contains no conversations part.`);
  }

  const conversations = conversationParts.flatMap((p) =>
    readConversationsZip(join(dir, p.filename)),
  );
  assertUniqueUuids(conversations);

  // Projects only ever save a link list from a false alarm, so a missing part
  // is worth a warning, not a failed run.
  const projectUuids: string[] = [];
  for (const part of projectParts) {
    const partPath = join(dir, part.filename);
    if (!existsSync(partPath)) {
      warnings.push(
        `the manifest lists ${part.filename}, which is not in ${dir}. ` +
          'Project uuids in a link list will be reported as unknown conversations.',
      );
      continue;
    }
    projectUuids.push(...readProjectUuids(partPath));
  }

  return {
    path: dir,
    form: 'directory',
    createdAt,
    conversations,
    projectUuids,
    warnings,
  };
}

/** The parts a manifest lists, and its metadata. */
export function parseManifest(
  text: string,
  path = 'manifest.json',
): { parts: ManifestPart[]; createdAt: string | null; version: unknown } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (cause) {
    throw new UsageError(`${path} is not valid JSON: ${(cause as Error).message}`);
  }
  if (
    typeof raw !== 'object' ||
    raw === null ||
    !Array.isArray((raw as never)['data_files'])
  ) {
    throw new UsageError(`${path} has no data_files list.`);
  }

  const manifest = raw as {
    data_files: unknown[];
    created_at?: unknown;
    version?: unknown;
  };
  const parts = manifest.data_files.flatMap((entry): ManifestPart[] => {
    if (typeof entry !== 'object' || entry === null) return [];
    const { category, filename } = entry as { category?: unknown; filename?: unknown };
    return typeof category === 'string' && typeof filename === 'string'
      ? [{ category, filename: basename(filename) }]
      : [];
  });

  return {
    parts,
    createdAt: typeof manifest.created_at === 'string' ? manifest.created_at : null,
    version: manifest.version,
  };
}

/**
 * The conversations in one zip: the entry whose name stem is `conversations`,
 * whatever its extension. `protocol-era`'s extractor found exports using
 * `.dms` (brief §5.1).
 */
function readConversationsZip(path: string): RawConversation[] {
  const isConversations = (name: string) =>
    basename(name, extname(name)) === 'conversations';

  const entries = unzipSync(readFileSync(path), {
    filter: (file) => isConversations(file.name),
  });
  const names = Object.keys(entries);

  if (names.length !== 1) {
    throw new UsageError(
      names.length === 0
        ? `${path} has no conversations entry.`
        : `${path} has ${names.length} conversations entries (${names.join(', ')}); expected one.`,
    );
  }

  const name = names[0] as string;
  return parseConversations(strFromU8(entries[name] as Uint8Array), `${path}:${name}`);
}

/** Project uuids from a projects zip: one `projects/<uuid>.json` per project. */
function readProjectUuids(path: string): string[] {
  const entries = unzipSync(readFileSync(path), {
    filter: (file) => file.name.endsWith('.json'),
  });
  const uuids: string[] = [];
  for (const [name, bytes] of Object.entries(entries)) {
    try {
      const project = JSON.parse(strFromU8(bytes)) as { uuid?: unknown };
      if (typeof project.uuid === 'string') uuids.push(project.uuid);
    } catch {
      throw new UsageError(`${path}:${name} is not valid JSON.`);
    }
  }
  return uuids.sort();
}

/** A conversations file's text, which must be a JSON array. */
export function parseConversations(text: string, source: string): RawConversation[] {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (cause) {
    throw new UsageError(`${source} is not valid JSON: ${(cause as Error).message}`);
  }
  if (!Array.isArray(raw)) {
    throw new UsageError(`${source} is not a list of conversations.`);
  }
  return raw as RawConversation[];
}

/**
 * Two parts holding the same conversation would mean the format changed under
 * us. Picking one silently is how a conversation gets rendered from the wrong
 * copy.
 */
function assertUniqueUuids(conversations: RawConversation[]): void {
  const seen = new Set<string>();
  for (const conversation of conversations) {
    if (typeof conversation.uuid !== 'string') continue;
    if (seen.has(conversation.uuid)) {
      throw new UsageError(
        `conversation ${conversation.uuid} appears in more than one part of the export.`,
      );
    }
    seen.add(conversation.uuid);
  }
}
