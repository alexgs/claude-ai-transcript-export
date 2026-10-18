import { describe, expect, it } from 'vitest';
import {
  parseTranscript,
  renderTranscript,
} from '@alexgsdev/claude-code-transcript-export';
import { buildTurns } from '../src/turns.js';
import { chooseBranch } from '../src/tree.js';
import { linear, text, toolUse } from './factories.js';
import type { RawBlock } from '../src/types.js';

const PATH = '/mnt/user-data/outputs/guide.md';
// `null` for "no path": an explicit undefined would take the default.
const create = (t: string, path: string | null = PATH) =>
  toolUse(
    'create_file',
    path === null ? { file_text: t } : { path, file_text: t, description: 'd' },
  );
const replace = (oldStr: string, newStr: string, path: string | null = PATH) =>
  toolUse(
    'str_replace',
    path === null
      ? { old_str: oldStr, new_str: newStr }
      : { path, old_str: oldStr, new_str: newStr },
  );
const present = (...paths: string[]) => toolUse('present_files', { filepaths: paths });
const bash = (command: string) => toolUse('bash_tool', { command, description: 'd' });

/** Alternating turns, human first, from the assistant turns' blocks. */
function run(...assistantTurns: RawBlock[][]) {
  const turns = assistantTurns.flatMap(
    (blocks, i): Array<['human' | 'assistant', RawBlock[]]> => [
      ['human', [text(`q${i + 1}`)]],
      ['assistant', blocks],
    ],
  );
  return buildTurns(chooseBranch(linear(turns)).messages);
}
const assistant = (built: ReturnType<typeof run>, n: number) =>
  built.turns[n - 1]?.text ?? '';

describe('the document model', () => {
  it('renders a clean replay once, where it was last edited, with markers before', () => {
    const built = run(
      [text('Drafting.'), create('# Guide\n\nalpha')],
      [replace('alpha', 'beta')],
      [replace('beta', 'gamma'), text('Done.')],
    );
    expect(assistant(built, 2)).toBe(
      'Drafting.\n\n> [document: guide.md — created; final version in turn 6]',
    );
    expect(assistant(built, 4)).toBe(
      '> [document: guide.md — edited; final version in turn 6]',
    );
    expect(assistant(built, 6)).toBe(
      '**`/mnt/user-data/outputs/guide.md`** — created in turn 2, edited 2 times, final version.' +
        '\n\n```markdown\n# Guide\n\ngamma\n```\n\nDone.',
    );
    expect(built.documents).toMatchObject({ documents: 1, replayed: 1, fellBack: [] });
  });

  it('places the final version at a later presentation, after its marker', () => {
    const built = run([create('v1')], [text('Here it is.'), present(PATH)]);
    expect(assistant(built, 2)).toBe(
      '> [document: guide.md — created; final version in turn 4]',
    );
    expect(assistant(built, 4)).toBe(
      'Here it is.\n\n> [presented: guide.md]\n\n' +
        '**`/mnt/user-data/outputs/guide.md`** — created in turn 2, final version.\n\n```markdown\nv1\n```',
    );
  });

  it('says "below" for an earlier operation in the same turn as the final version', () => {
    const built = run([create('a'), replace('a', 'b')]);
    expect(assistant(built, 2)).toMatch(
      /^> \[document: guide\.md — created; final version below\]\n\n\*\*/,
    );
    expect(assistant(built, 2)).toContain('edited once, final version.');
  });

  it('falls back, whole, when an edit matches nowhere', () => {
    const built = run(
      [create('alpha')],
      [replace('missing', 'x')],
      [replace('alpha', 'beta')],
    );
    expect(built.documents?.fellBack).toEqual(['`/mnt/user-data/outputs/guide.md`']);
    expect(assistant(built, 2)).toContain('Its later edits did not all apply');
    expect(assistant(built, 2)).toContain('```markdown\nalpha\n```');
    expect(assistant(built, 4)).toBe(
      '**`/mnt/user-data/outputs/guide.md`** — edited.\n\n```diff\n- missing\n+ x\n```',
    );
    // The edit that would have applied is not applied: the replay is
    // abandoned as a whole, never half-applied.
    expect(assistant(built, 6)).toContain('```diff\n- alpha\n+ beta\n```');
    expect(built.turns.map((t) => t.text).join('\n')).not.toContain('final version');
  });

  it('falls back when an edit matches twice', () => {
    const built = run([create('x and x')], [replace('x', 'y')]);
    expect(built.documents?.fellBack).toHaveLength(1);
  });

  it('warns when a shell command names the path after creation', () => {
    const built = run([create('a')], [bash(`sed -i 's/a/b/' ${PATH}`)]);
    expect(assistant(built, 2)).toContain('Also touched by shell commands');
    expect(built.documents?.shellTouched).toBe(1);
  });

  it('still warns when the shell command is itself kept by keepTools', () => {
    const turns = [
      ['human', [text('q')]],
      ['assistant', [create('a'), bash(`wc -l ${PATH}`)]],
    ] as Array<['human' | 'assistant', RawBlock[]]>;
    const built = buildTurns(chooseBranch(linear(turns)).messages, {
      tools: 'strip',
      thinking: 'drop',
      attachments: 'marker',
      keepTools: ['bash_tool'],
    });
    expect(assistant(built, 2)).toContain('Also touched by shell commands');
    expect(assistant(built, 2)).toContain('```tool_use:bash_tool');
  });

  it('does not warn about a shell command before creation', () => {
    const built = run([bash(`mkdir -p ${PATH}`)], [create('a')]);
    expect(assistant(built, 4)).not.toContain('shell commands');
  });

  it('renders an edit to a file never created here as a diff, in place', () => {
    const built = run([replace('old', 'new', '/mnt/user-data/uploads/notes.md')]);
    expect(assistant(built, 2)).toBe(
      '**`/mnt/user-data/uploads/notes.md`** — edited; no earlier version is in this conversation.' +
        '\n\n```diff\n- old\n+ new\n```',
    );
    expect(built.documents?.looseEdits).toBe(1);
  });

  it('renders an edit with no path as a diff, in place', () => {
    const built = run([replace('old', 'new', null)]);
    expect(assistant(built, 2)).toContain('**a file (no path given)** — edited');
  });

  it('renders a create_file with no path in place', () => {
    const built = run([create('loose text', null)]);
    expect(assistant(built, 2)).toBe(
      '**(unnamed file)** — created in turn 2.\n\n```\nloose text\n```',
    );
  });

  it('replays artifacts like files: create, update, rewrite', () => {
    const art = (input: object) =>
      toolUse('artifacts', { id: 'faction-guide', version_uuid: 'v', ...input });
    const built = run(
      [
        art({
          command: 'create',
          title: 'Faction Guide',
          type: 'text/markdown',
          content: 'one',
        }),
      ],
      [art({ command: 'update', old_str: 'one', new_str: 'two' })],
      [art({ command: 'rewrite', content: 'three' })],
    );
    expect(assistant(built, 2)).toBe(
      '> [document: Faction Guide — created; final version in turn 6]',
    );
    expect(assistant(built, 4)).toBe(
      '> [document: Faction Guide — edited; final version in turn 6]',
    );
    expect(assistant(built, 6)).toBe(
      '**Faction Guide (artifact)** — created in turn 2, edited 2 times, final version.\n\n```markdown\nthree\n```',
    );
  });

  it('turns the model off under tools: keep, rendering every payload as JSON', () => {
    const turns = [
      ['human', [text('q')]],
      ['assistant', [create('a')]],
    ] as Array<['human' | 'assistant', RawBlock[]]>;
    const built = buildTurns(chooseBranch(linear(turns)).messages, {
      tools: 'keep',
      thinking: 'drop',
      attachments: 'marker',
    });
    expect(built.documents).toBeNull();
    expect(assistant(built, 2)).toContain('```tool_use:create_file');
    expect(assistant(built, 2)).not.toContain('final version');
  });

  it('fences a document so a quoted turn heading and backticks stay inside', () => {
    const doc = 'Notes\n\n## [3] Human\n\n````\ncode\n````';
    const built = run([create(doc)]);
    expect(assistant(built, 2)).toContain('`````markdown\n' + doc + '\n`````');
  });

  it('keeps a quoted turn heading from being mismeasured on read-back', () => {
    // cctx's readTurnHeadings scans the whole body, fences included. A quoted
    // heading out of sequence makes it decline to measure, never misreport:
    // turns still come from the frontmatter, and alternation is not counted.
    const built = run([create('## [2] Human\n\nquoted')]);
    const doc = renderTranscript(
      {
        id: 'c0ffee00-0000-4000-8000-000000000001',
        title: 'T',
        created: '2026-08-24',
        updated: '2026-08-24',
        turns: built.turns,
      },
      { extractedOn: '2026-10-18', source: 'claude-ai' },
    );
    const read = parseTranscript('2026-08-24--t--c0ffee00.md', doc);
    expect(read?.turns).toBe(2);
    expect(read?.parity).toBeNull();
  });

  it('leaves no placeholder behind', () => {
    const built = run(
      [create('a'), present(PATH)],
      [replace('a', 'b'), present(PATH, '/x/other.md')],
    );
    expect(built.turns.map((t) => t.text).join('')).not.toMatch(/[]/);
  });
});
