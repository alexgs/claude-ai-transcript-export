import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { strToU8, zipSync } from 'fflate';

const FIXTURES = fileURLToPath(new URL('./fixtures/export/', import.meta.url));

/** A scratch directory. Tests never read a real export. */
export function tempDir(prefix = 'caitx-test-'): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

/** A checked-in fixture file, parsed. */
export function fixture<T = unknown>(name: string): T {
  return JSON.parse(readFileSync(join(FIXTURES, name), 'utf8')) as T;
}

export interface BuildExportOptions {
  conversations?: unknown[];
  projects?: Array<{ uuid: string }>;
  /**
   * Parts listed in the manifest but not written to disk, to exercise the
   * missing-part check (specification §4.1).
   */
  missing?: string[];
  /** Write no `manifest.json`. */
  noManifest?: boolean;
  /** The conversations entry's name inside its zip. */
  conversationsEntry?: string;
  /**
   * Further files in the export directory, listed in the manifest by the
   * category their name implies: a `light_metadata-000.zip` that is not a zip,
   * to prove it is never opened.
   */
  extra?: Record<string, Uint8Array | string>;
}

/**
 * Builds an export directory shaped like a real one (brief §3.1): a
 * `manifest.json` and one zip per category.
 *
 * Built at test time from JSON rather than checked in as zips, because JSON
 * diffs in review and a binary zip does not (specification §14). Defaults to
 * the checked-in fixtures; a test passes its own conversations to add a case.
 */
export function buildExport(options: BuildExportOptions = {}): string {
  const dir = tempDir('caitx-export-');
  const conversations =
    options.conversations ?? fixture<unknown[]>('conversations.json');
  const projects =
    options.projects ?? fixture<Array<{ uuid: string }>>('projects.json');

  const parts: Record<string, Record<string, Uint8Array>> = {
    'conversations-000.zip': {
      [options.conversationsEntry ?? 'conversations.json']: strToU8(
        JSON.stringify(conversations),
      ),
    },
    'projects-000.zip': Object.fromEntries(
      projects.map((p) => [`projects/${p.uuid}.json`, strToU8(JSON.stringify(p))]),
    ),
  };

  for (const [name, entries] of Object.entries(parts)) {
    if (options.missing?.includes(name)) continue;
    writeFileSync(join(dir, name), zipSync(entries));
  }

  for (const [name, contents] of Object.entries(options.extra ?? {})) {
    writeFileSync(join(dir, name), contents);
  }

  if (options.noManifest) return dir;

  const listed = [...Object.keys(parts), ...Object.keys(options.extra ?? {})];
  const manifest = {
    created_at: '2026-10-18T13:26:16.851801+00:00',
    total_files: listed.length,
    data_files: listed.map((filename, batch_index) => ({
      batch_index,
      category: filename.replace(/-\d+\.zip$/, ''),
      part: 0,
      filename,
    })),
    version: '1.0',
  };
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));

  return dir;
}
