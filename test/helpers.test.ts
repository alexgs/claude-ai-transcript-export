import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { strFromU8, unzipSync } from 'fflate';
import { buildExport, fixture } from './helpers.js';

const read = (dir: string, zip: string) => unzipSync(readFileSync(join(dir, zip)));

describe('buildExport', () => {
  it('writes a manifest naming every part', () => {
    const dir = buildExport();
    const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
    expect(manifest.data_files.map((f: { filename: string }) => f.filename)).toEqual([
      'conversations-000.zip',
      'projects-000.zip',
    ]);
  });

  it('round-trips the fixture conversations through the zip', () => {
    const entries = read(buildExport(), 'conversations-000.zip');
    expect(Object.keys(entries)).toEqual(['conversations.json']);
    expect(JSON.parse(strFromU8(entries['conversations.json']!))).toEqual(
      fixture('conversations.json'),
    );
  });

  it('writes one project file per project', () => {
    const entries = read(buildExport(), 'projects-000.zip');
    expect(Object.keys(entries)).toEqual([
      'projects/0190f1c5-0000-7000-8000-000000000001.json',
    ]);
  });

  it('lists a missing part in the manifest without writing it', () => {
    const dir = buildExport({ missing: ['projects-000.zip'] });
    expect(existsSync(join(dir, 'projects-000.zip'))).toBe(false);
    expect(readFileSync(join(dir, 'manifest.json'), 'utf8')).toContain(
      'projects-000.zip',
    );
  });
});
