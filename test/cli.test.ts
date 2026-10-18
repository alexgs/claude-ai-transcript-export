import { describe, expect, it } from 'vitest';
import { Writable } from 'node:stream';
import { createRequire } from 'node:module';
import { VERSION, main } from '../src/cli/index.js';

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
    const result = run(['probe', '/some/export']);
    expect(result.code).toBe(1);
    expect(result.err).toContain('not implemented yet');
  });

  it('names an unknown command, as a usage error', () => {
    const result = run(['prob']);
    expect(result.code).toBe(2);
    expect(result.err).toContain('unknown command `prob`');
  });
});
