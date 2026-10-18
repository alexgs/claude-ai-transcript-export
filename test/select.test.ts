import { describe, expect, it } from 'vitest';
import { UsageError } from '@alexgsdev/claude-code-transcript-export';
import { mergeConfig } from '../src/config.js';
import { select, type SelectInput } from '../src/select.js';

const A = 'aaaaaaaa-0000-4000-8000-000000000001';
const B = 'bbbbbbbb-0000-4000-8000-000000000002';
const C = 'cccccccc-0000-4000-8000-000000000003';
const GONE = 'dddddddd-0000-4000-8000-000000000004';
const P = '0190f1c5-0000-7000-8000-000000000001';

const conversations = [
  { uuid: A, name: 'Alpha', chat_messages: [] },
  { uuid: B, name: 'Beta', chat_messages: [] },
  { uuid: C, name: 'Beta', chat_messages: [] },
];

function input(
  raw: object,
  lists: Record<string, string> = {},
  onDisk: string[] = [],
): SelectInput {
  return {
    conversations,
    projectUuids: [P],
    config: mergeConfig(raw),
    lists: new Map(Object.entries(lists)),
    onDisk: new Set(onDisk),
  };
}

const project = (name: string, list = `${name}.txt`) => ({ name, list });

describe('select', () => {
  it('selects a project list, counting what it resolved to', () => {
    const s = select(
      input({ projects: [project('P')] }, { P: `${A}\n${B}\nproject ${P}` }),
    );
    expect(s.selected.map((x) => [x.uuid, x.project?.name])).toEqual([
      [A, 'P'],
      [B, 'P'],
    ]);
    expect(s.projects).toEqual([{ name: 'P', total: 2, inExport: 2, carried: 0 }]);
    expect(s.skippedProjectUuids).toEqual([P]);
  });

  it('fails, naming every unknown uuid, before selecting anything', () => {
    const run = () =>
      select(
        input(
          { projects: [project('P')] },
          { P: `${A}\neeeeeeee-0000-4000-8000-00000000000e` },
        ),
      );
    expect(run).toThrow(UsageError);
    expect(run).toThrow(/nothing was written[\s\S]*eeeeeeee/);
  });

  it('carries a uuid that has a transcript on disk but is not in the export', () => {
    const s = select(
      input({ projects: [project('P')] }, { P: `${A}\n${GONE}` }, [GONE]),
    );
    expect(s.projects[0]).toEqual({ name: 'P', total: 2, inExport: 1, carried: 1 });
    expect(s.selected.find((x) => x.uuid === GONE)?.conversation).toBeUndefined();
  });

  it('refuses a conversation in two projects', () => {
    expect(() =>
      select(input({ projects: [project('P'), project('Q')] }, { P: A, Q: A })),
    ).toThrow(/in both P and Q/);
  });

  it('selects a conversation in a project and in conversations once, under the project', () => {
    const s = select(
      input(
        { projects: [project('P')], conversations: [{ uuid: A, note: 'own note' }] },
        { P: A },
      ),
    );
    expect(s.selected).toHaveLength(1);
    expect(s.selected[0]).toMatchObject({
      uuid: A,
      project: { name: 'P' },
      note: 'own note',
    });
  });

  it('gives a project conversation its project note when it has none of its own', () => {
    const s = select(
      input({ projects: [{ name: 'P', list: 'p', note: 'pn' }] }, { P: A }),
    );
    expect(s.selected[0]?.note).toBe('pn');
  });

  it('resolves a title selector to exactly one conversation, and reports it', () => {
    const s = select(input({ conversations: [{ title: 'alpha' }] }));
    expect(s.selected.map((x) => x.uuid)).toEqual([A]);
    expect(s.titles).toEqual([{ title: 'alpha', uuid: A }]);
  });

  it('refuses a title matching none or several', () => {
    expect(() => select(input({ conversations: [{ title: 'Gamma' }] }))).toThrow(
      /no conversation is titled/,
    );
    expect(() => select(input({ conversations: [{ title: 'Beta' }] }))).toThrow(
      /2 conversations are titled/,
    );
  });

  it('lets exclude win over every selector', () => {
    const s = select(
      input(
        { projects: [project('P')], conversations: [{ uuid: C }], exclude: [B, C] },
        { P: `${A}\n${B}` },
      ),
    );
    expect(s.selected.map((x) => x.uuid)).toEqual([A]);
    expect(s.excluded).toEqual([B, C]);
    expect(s.projects[0]?.total).toBe(1);
  });

  it('reports a project whose list could not be read', () => {
    expect(() => select(input({ projects: [project('P', 'missing.txt')] }))).toThrow(
      /missing\.txt could not be read/,
    );
  });
});
