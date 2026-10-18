import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfigFile } from '../src/config.js';
import { extract } from '../src/extract.js';
import { readExport } from '../src/input.js';
import { formatProbe, probeConversations } from '../src/probe.js';
import { buildExport, fixture, tempDir } from './helpers.js';

/**
 * Snapshots over `rich.json`, a synthetic export that exercises every block
 * type and rule the specification names, plus one block type it does not
 * (`hologram`). A change to how anything is handled changes a snapshot here,
 * so it is made on purpose (specification §14).
 *
 * Dates in transcripts and filenames are local, so they depend on the
 * machine's timezone. They are masked before comparing; the tests that care
 * about dates compute them.
 */
const exportDir = () => buildExport({ conversations: fixture('rich.json') });
const maskDates = (s: string) =>
  s
    .replace(/^(created|updated): \d{4}-\d{2}-\d{2}$/gm, '$1: <local date>')
    .replace(/^\| \d{4}-\d{2}-\d{2} \|/gm, '| <local date> |');

describe('the rich fixture', () => {
  it('probes as expected', () => {
    const report = probeConversations(readExport(exportDir()).conversations);
    expect(formatProbe(report)).toMatchSnapshot();
  });

  it('extracts as expected', () => {
    const root = tempDir();
    writeFileSync(
      join(root, '.caitx.yaml'),
      [
        'out: out',
        'projects:',
        '  - name: Fixture',
        '    uuid: 0190f1c5-0000-7000-8000-000000000001',
        '    list: p.txt',
        '',
      ].join('\n'),
    );
    writeFileSync(
      join(root, 'p.txt'),
      [
        '# Pasted from the project page',
        'https://claude.ai/chat/f1c0ffee-0000-4000-8000-000000000001',
        'https://claude.ai/project/0190f1c5-0000-7000-8000-000000000001',
        'f1c0ffee-0000-4000-8000-000000000002',
        '',
      ].join('\n'),
    );
    const summary = extract({
      input: readExport(exportDir()),
      resolved: loadConfigFile(join(root, '.caitx.yaml')),
      today: '2026-10-18',
    });
    expect(summary.skippedProjectUuids).toEqual([
      '0190f1c5-0000-7000-8000-000000000001',
    ]);

    const out = join(root, 'out');
    const files = readdirSync(out).sort();
    expect(
      files.map((f) => f.replace(/^\d{4}-\d{2}-\d{2}--/, '<date>--')),
    ).toMatchSnapshot();
    for (const file of files) {
      expect(maskDates(readFileSync(join(out, file), 'utf8'))).toMatchSnapshot(
        file.replace(/^\d{4}-\d{2}-\d{2}--/, ''),
      );
    }
  });
});
