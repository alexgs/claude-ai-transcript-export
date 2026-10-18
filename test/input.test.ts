import { describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { UsageError } from '@alexgsdev/claude-code-transcript-export';
import { parseManifest, readExport } from '../src/input.js';
import { buildExport, fixture, tempDir } from './helpers.js';

const conversation = (uuid: string) => ({ uuid, name: uuid, chat_messages: [] });

describe('readExport', () => {
  it('reads all three forms to the same conversations', () => {
    const dir = buildExport();
    const bare = join(tempDir(), 'conversations.json');
    writeFileSync(bare, JSON.stringify(fixture('conversations.json')));

    const forms = [
      readExport(dir),
      readExport(join(dir, 'conversations-000.zip')),
      readExport(bare),
    ];
    expect(forms.map((f) => f.form)).toEqual(['directory', 'zip', 'file']);
    for (const form of forms) {
      expect(form.conversations).toEqual(fixture('conversations.json'));
    }
  });

  it('reads project uuids only from the directory form', () => {
    const dir = buildExport();
    expect(readExport(dir).projectUuids).toEqual([
      '0190f1c5-0000-7000-8000-000000000001',
    ]);
    expect(readExport(join(dir, 'conversations-000.zip')).projectUuids).toEqual([]);
  });

  it('records the manifest date', () => {
    expect(readExport(buildExport()).createdAt).toBe(
      '2026-10-18T13:26:16.851801+00:00',
    );
  });

  it('finds the conversations entry by name stem, so .dms works', () => {
    const dir = buildExport({ conversationsEntry: 'conversations.dms' });
    expect(readExport(dir).conversations).toHaveLength(1);
  });

  it('reads a bare .dms file', () => {
    const path = join(tempDir(), 'conversations.dms');
    writeFileSync(path, JSON.stringify([conversation('a')]));
    expect(readExport(path).conversations).toHaveLength(1);
  });

  it('fails, reading nothing, when the manifest lists a missing conversations part', () => {
    const dir = buildExport({ missing: ['conversations-000.zip'] });
    expect(() => readExport(dir)).toThrow(/conversations-000\.zip, which is not in/);
  });

  it('warns, but reads, when the projects part is missing', () => {
    const input = readExport(buildExport({ missing: ['projects-000.zip'] }));
    expect(input.conversations).toHaveLength(1);
    expect(input.projectUuids).toEqual([]);
    expect(input.warnings.join('\n')).toContain('projects-000.zip');
  });

  it('reads a directory with no manifest, and says nothing confirms it is complete', () => {
    const input = readExport(buildExport({ noManifest: true }));
    expect(input.conversations).toHaveLength(1);
    expect(input.createdAt).toBeNull();
    expect(input.warnings.join('\n')).toContain('no manifest.json');
  });

  it('never opens light_metadata, even when it is listed and corrupt', () => {
    // If the reader opened it, unzipping garbage would throw. A clean run is
    // the proof that it was never touched.
    const dir = buildExport({
      extra: { 'light_metadata-000.zip': 'not a zip at all' },
    });
    expect(readFileSync(join(dir, 'manifest.json'), 'utf8')).toContain(
      'light_metadata',
    );
    expect(readExport(dir).conversations).toHaveLength(1);
  });

  it('concatenates conversations parts in manifest order', () => {
    const dir = buildExport({ conversations: [conversation('a')] });
    const second = buildExport({ conversations: [conversation('b')] });
    writeFileSync(
      join(dir, 'conversations-001.zip'),
      readFileSync(join(second, 'conversations-000.zip')),
    );
    const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
    manifest.data_files.push({
      category: 'conversations',
      part: 1,
      filename: 'conversations-001.zip',
    });
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest));

    expect(readExport(dir).conversations.map((c) => c.uuid)).toEqual(['a', 'b']);
  });

  it('refuses a conversation that appears in two parts', () => {
    const dir = buildExport({ conversations: [conversation('a')] });
    writeFileSync(
      join(dir, 'conversations-001.zip'),
      readFileSync(join(dir, 'conversations-000.zip')),
    );
    const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
    manifest.data_files.push({
      category: 'conversations',
      part: 1,
      filename: 'conversations-001.zip',
    });
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest));

    expect(() => readExport(dir)).toThrow(/more than one part/);
  });

  it('warns about an unfamiliar manifest version', () => {
    const dir = buildExport();
    const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
    writeFileSync(
      join(dir, 'manifest.json'),
      JSON.stringify({ ...manifest, version: '2.0' }),
    );
    expect(readExport(dir).warnings.join('\n')).toContain('version "2.0"');
  });

  it('is a usage error for a path that does not exist, and for a non-array file', () => {
    expect(() => readExport(join(tempDir(), 'nope'))).toThrow(UsageError);
    const path = join(tempDir(), 'conversations.json');
    writeFileSync(path, '{"not": "a list"}');
    expect(() => readExport(path)).toThrow(/not a list of conversations/);
  });
});

describe('parseManifest', () => {
  it('reads category and filename, ignoring a malformed entry', () => {
    const { parts } = parseManifest(
      JSON.stringify({
        data_files: [{ category: 'conversations', filename: 'c.zip' }, 7],
      }),
    );
    expect(parts).toEqual([{ category: 'conversations', filename: 'c.zip' }]);
  });

  it('takes only the basename of a listed filename', () => {
    // A manifest naming ../../elsewhere must not send the reader outside the
    // export directory.
    const { parts } = parseManifest(
      JSON.stringify({
        data_files: [{ category: 'conversations', filename: '../../x.zip' }],
      }),
    );
    expect(parts[0]?.filename).toBe('x.zip');
  });

  it('refuses a manifest with no data_files', () => {
    expect(() => parseManifest('{}')).toThrow(/no data_files/);
  });
});
