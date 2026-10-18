import { describe, expect, it } from 'vitest';
import { Writable } from 'node:stream';
import { createRequire } from 'node:module';
import { VERSION, main } from '../src/cli/index.js';
import { buildExport } from './helpers.js';

function run(argv: string[]) {
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
    const result = run(['list', buildExport()]);
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
