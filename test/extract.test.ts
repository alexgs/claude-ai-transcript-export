import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { extract } from '../src/extract.js';
import { readExport } from '../src/input.js';
import { loadConfigFile } from '../src/config.js';
import { buildExport, tempDir } from './helpers.js';
import { conversation, linear, message, text } from './factories.js';
import { ROOT_PARENT } from '../src/tree.js';
import type { RawConversation } from '../src/types.js';

const A = 'aaaaaaaa-0000-4000-8000-000000000001';
const B = 'bbbbbbbb-0000-4000-8000-000000000002';

const conv = (
  uuid: string,
  name: string,
  at = '2026-08-24T12:00:00Z',
): RawConversation => {
  const c = linear(
    [
      ['human', [text(`question for ${name}`)]],
      ['assistant', [text('answer')]],
    ],
    {
      uuid,
      name,
    },
  );
  c.created_at = at;
  for (const m of c.chat_messages!) m.created_at = at;
  return c;
};

/** A project root with a config and link list, and a way to run extract in it. */
function setup(yaml: string, list = `${A}\n${B}\n`) {
  const root = tempDir();
  writeFileSync(join(root, '.caitx.yaml'), yaml);
  writeFileSync(join(root, 'p.txt'), list);
  const go = (conversations: RawConversation[], today = '2026-10-18', dryRun = false) =>
    extract({
      input: readExport(buildExport({ conversations })),
      resolved: loadConfigFile(join(root, '.caitx.yaml')),
      today,
      dryRun,
    });
  const files = () => readdirSync(join(root, 'out')).sort();
  const read = (name: string) => readFileSync(join(root, 'out', name), 'utf8');
  return { root, go, files, read };
}

const PROJECT = 'out: out\nprojects:\n  - name: Fixture\n    list: p.txt\n';

describe('extract', () => {
  it('writes a transcript per selected conversation, and an index', () => {
    const { go, files, read } = setup(PROJECT);
    const summary = go([conv(A, 'Alpha'), conv(B, 'Beta')]);
    expect(summary).toMatchObject({ conversations: 2, written: 3, unchanged: 0 });
    expect(files()).toEqual(
      [
        'index.md',
        expect.stringMatching(/--alpha--aaaaaaaa\.md$/),
        expect.stringMatching(/--beta--bbbbbbbb\.md$/),
      ].sort(),
    );
    const alpha = read(files().find((f) => f.includes('alpha'))!);
    expect(alpha).toContain('source: claude-ai');
    expect(alpha).toContain('project: Fixture');
    expect(alpha).toContain(`url: https://claude.ai/chat/${A}`);
    expect(read('index.md')).toContain(`[Alpha](https://claude.ai/chat/${A})`);
  });

  it('writes zero files when rerun over the same export', () => {
    const { go } = setup(PROJECT);
    const convs = [conv(A, 'Alpha'), conv(B, 'Beta')];
    go(convs, '2026-10-18');
    const again = go(convs, '2026-10-19');
    expect(again).toMatchObject({ written: 0, unchanged: 3 });
  });

  it('writes nothing when only updated_at moved', () => {
    // The stronger property (§9): a newer export with no change to what is
    // rendered writes nothing, which is why `updated` comes from the last
    // message on the branch, not from updated_at.
    const { go, files, read } = setup(PROJECT, `${A}\n`);
    const before = conv(A, 'Alpha');
    go([before]);
    const name = files().find((f) => f.includes('alpha'))!;
    const original = read(name);

    const after = structuredClone(before);
    after.updated_at = '2026-10-17T12:00:00Z';
    expect(go([after], '2026-10-19').written).toBe(0);
    expect(read(name)).toBe(original);
  });

  it('rewrites a transcript whose conversation gained a branch, which is a real change', () => {
    // A regenerated reply is newer, so it becomes the rendered branch, and
    // branches_dropped appears. Both change what the transcript says.
    const { go, files, read } = setup(PROJECT, `${A}\n`);
    const before = conv(A, 'Alpha');
    go([before]);
    const after = structuredClone(before);
    const human = after.chat_messages![0]!;
    after.chat_messages!.push(
      message('regen', human.uuid as string, 'assistant', [text('a better answer')], {
        created_at: '2026-09-01T12:00:00Z',
      }),
    );
    // One: the transcript. Its index row (title, date, two turns) is
    // unchanged, so index.md is not rewritten.
    expect(go([after], '2026-10-19').written).toBe(1);
    const doc = read(files().find((f) => f.includes('alpha'))!);
    expect(doc).toContain('branches_dropped: 1');
    expect(doc).toContain('a better answer');
    expect(doc).toContain('extracted: 2026-10-19');
  });

  it('deletes the old file when a conversation is renamed, and reports it', () => {
    const { go, files } = setup(PROJECT, `${A}\n`);
    go([conv(A, 'Alpha')]);
    const summary = go([conv(A, 'Alpha Renamed')]);
    expect(summary.removed).toEqual([
      { name: expect.stringMatching(/--alpha--aaaaaaaa\.md$/), reason: 'renamed' },
    ]);
    expect(files().filter((f) => f.includes('aaaaaaaa'))).toEqual([
      expect.stringMatching(/--alpha-renamed--aaaaaaaa\.md$/),
    ]);
  });

  it('deletes an excluded conversation’s transcript, and reports it', () => {
    const { root, go, files } = setup(PROJECT);
    go([conv(A, 'Alpha'), conv(B, 'Beta')]);
    writeFileSync(join(root, '.caitx.yaml'), `${PROJECT}exclude:\n  - ${B}\n`);
    const summary = go([conv(A, 'Alpha'), conv(B, 'Beta')]);
    expect(summary.removed.map((r) => r.reason)).toEqual(['excluded']);
    expect(files().some((f) => f.includes('bbbbbbbb'))).toBe(false);
  });

  it('keeps a deselected conversation’s transcript, in the index, and reports it', () => {
    const { root, go, files, read } = setup(PROJECT);
    go([conv(A, 'Alpha'), conv(B, 'Beta')]);
    writeFileSync(join(root, 'p.txt'), `${A}\n`);
    const summary = go([conv(A, 'Alpha'), conv(B, 'Beta')]);
    expect(summary.deselected.map((d) => d.id)).toEqual([B]);
    expect(summary.removed).toEqual([]);
    expect(files().some((f) => f.includes('bbbbbbbb'))).toBe(true);
    expect(read('index.md')).toContain('Beta');
  });

  it('carries a conversation missing from a newer export, project column and all', () => {
    const { root, go, read } = setup(
      'out: out\nprojects:\n  - name: One\n    list: p.txt\n  - name: Two\n    list: q.txt\n',
      `${A}\n${B}\n`,
    );
    writeFileSync(join(root, 'q.txt'), '');
    go([conv(A, 'Alpha'), conv(B, 'Beta')]);
    // B is deleted on claude.ai: absent from the next export, still listed.
    const summary = go([conv(A, 'Alpha')]);
    expect(summary.projects[0]).toEqual({
      name: 'One',
      total: 2,
      inExport: 1,
      carried: 1,
    });
    expect(summary.carried.map((c) => c.id)).toEqual([B]);
    const index = read('index.md');
    expect(index).toContain('| Project |');
    expect(index).toMatch(
      /\[Beta\]\(https:\/\/claude\.ai\/chat\/bbbbbbbb[^)]*\) \| 2 \| One \|/,
    );
    expect(index).toContain('One row below was read back');
  });

  it('names an untitled conversation from its first human line, marked as derived', () => {
    const { go, files, read } = setup(PROJECT, `${A}\n`);
    go([conv(A, '')]);
    const name = files().find((f) => f.includes('aaaaaaaa'))!;
    expect(name).toMatch(/--question-for--aaaaaaaa\.md$/);
    expect(read(name)).toContain('title_derived: true');
  });

  it('never writes the account uuid', () => {
    const { go, files, read } = setup(PROJECT, `${A}\n`);
    const c = conv(A, 'Alpha');
    c.account = { uuid: 'acc-SECRET-0000' };
    go([c]);
    for (const f of files()) expect(read(f)).not.toContain('acc-SECRET');
  });

  it('writes nothing under dryRun', () => {
    const { root, go } = setup(PROJECT, `${A}\n`);
    const summary = go([conv(A, 'Alpha')], '2026-10-18', true);
    expect(summary.conversations).toBe(1);
    expect(existsSync(join(root, 'out'))).toBe(false);
  });

  it('skips a conversation with no turns', () => {
    const { go } = setup(PROJECT, `${A}\n`);
    const empty = conversation([message('m', ROOT_PARENT, 'human', [])], {
      uuid: A,
      name: 'Empty',
    });
    const summary = go([empty]);
    expect(summary.skipped).toEqual([{ id: A, title: 'Empty', reason: 'empty' }]);
  });
});
