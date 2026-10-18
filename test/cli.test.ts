import { describe, expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { createRequire } from 'node:module';
import { toLocalDate } from '@alexgsdev/claude-code-transcript-export';
import { VERSION, main } from '../src/cli/index.js';
import { buildExport, tempDir } from './helpers.js';

export function run(argv: string[], cwd = tempDir()) {
  let out = '';
  let err = '';
  const sink = (append: (s: string) => void) =>
    new Writable({
      write(chunk, _encoding, done) {
        append(String(chunk));
        done();
      },
    });
  const code = main(argv, {
    stdout: sink((s) => (out += s)),
    stderr: sink((s) => (err += s)),
    cwd,
  });
  return { code, out, err };
}

describe('caitx', () => {
  it('prints usage with no arguments and for --help', () => {
    for (const argv of [[], ['--help'], ['-h']]) {
      const result = run(argv);
      expect(result.code).toBe(0);
      expect(result.out).toContain('caitx probe <export>');
    }
  });

  it('reports the version in package.json', () => {
    const { version } = createRequire(import.meta.url)('../package.json') as {
      version: string;
    };
    expect(VERSION).toBe(version);
    expect(run(['--version']).out).toBe(`${version}\n`);
  });

  it('says a known command is not implemented yet', () => {
    const result = run(['extract', buildExport()]);
    expect(result.code).toBe(1);
    expect(result.err).toContain('not implemented yet');
  });

  it('names an unknown command, as a usage error', () => {
    const result = run(['prob']);
    expect(result.code).toBe(2);
    expect(result.err).toContain('unknown command `prob`');
  });
});

describe('caitx probe', () => {
  it('reports counts for an export directory', () => {
    const result = run(['probe', buildExport()]);
    expect(result.code).toBe(0);
    expect(result.out).toContain('form: directory, created 2026-10-18T13:26:16');
    expect(result.out).toContain('conversations: 1 (0 with no messages)');
    expect(result.out).toContain('messages: 2');
    expect(result.out).toContain('Nothing outside what the specification handles.');
    expect(result.err).toBe('');
  });

  it('keeps --json parseable, with warnings on stderr', () => {
    const result = run(['probe', buildExport({ noManifest: true }), '--json']);
    expect(result.code).toBe(0);
    expect(result.err).toContain('caitx: warning:');
    const report = JSON.parse(result.out);
    expect(report.conversations).toBe(1);
    expect(report.export.form).toBe('directory');
  });

  it('is a usage error, exit 2, when a manifest part is missing', () => {
    const result = run(['probe', buildExport({ missing: ['conversations-000.zip'] })]);
    expect(result.code).toBe(2);
    expect(result.err).toContain('Download every part');
  });

  it('needs an export', () => {
    const result = run(['probe']);
    expect(result.code).toBe(2);
    expect(result.err).toContain('needs the path to an export');
  });

  it('names an unrecognized flag', () => {
    expect(run(['probe', buildExport(), '--jsno']).err).toContain('`--jsno`');
  });
});

describe('caitx list', () => {
  const C1 = 'c0ffee00-0000-4000-8000-000000000001';
  // Local dates, as `list` shows them: hardcoding one breaks in a timezone
  // where the fixture's instant falls on another day.
  const created = toLocalDate('2026-08-24T12:00:00.000000Z');
  const dayAfter = toLocalDate('2026-08-25T12:00:00.000000Z');

  it('shows every conversation as not selected when there is no config', () => {
    const result = run(['list', buildExport()]);
    expect(result.code).toBe(0);
    expect(result.out).toContain(`${C1}  ${created}`);
    expect(result.out).toContain('not selected');
    expect(result.err).toContain('nothing is selected');
  });

  it('marks a project conversation and prints the project count', () => {
    const root = tempDir();
    writeFileSync(
      join(root, '.caitx.yaml'),
      'projects:\n  - name: Fixture\n    list: p.txt\n',
    );
    writeFileSync(join(root, 'p.txt'), `https://claude.ai/chat/${C1}\n`);
    const result = run(['list', buildExport()], root);
    expect(result.out).toContain('selected: Fixture');
    expect(result.err).toContain(
      'Fixture: 1 conversations (1 in this export, 0 carried)',
    );
  });

  it('fails with exit 2 on a link-list uuid that resolves to nothing', () => {
    const root = tempDir();
    writeFileSync(
      join(root, '.caitx.yaml'),
      'projects:\n  - name: Fixture\n    list: p.txt\n',
    );
    writeFileSync(join(root, 'p.txt'), 'eeeeeeee-0000-4000-8000-00000000000e\n');
    const result = run(['list', buildExport()], root);
    expect(result.code).toBe(2);
    expect(result.err).toContain('eeeeeeee');
  });

  it('filters with --since and --unselected, and prints uuids with --format list', () => {
    const exportDir = buildExport();
    expect(run(['list', exportDir, '--since', dayAfter]).out).toBe('');
    expect(
      run(['list', exportDir, '--since', created, '--unselected', '--format', 'list'])
        .out,
    ).toBe(`${C1}\n`);
  });

  it('rejects a malformed --since', () => {
    expect(run(['list', buildExport(), '--since', '8/24']).code).toBe(2);
  });
});
