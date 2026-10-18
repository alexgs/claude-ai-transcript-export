import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../src/config.js';
import { renderIndex, type RenderIndexOptions } from '../src/render/index.js';

const entries = [
  {
    id: 'aaaaaaaa-0000-4000-8000-000000000001',
    title: 'Alpha',
    created: '2026-08-24',
    turns: [
      { speaker: 'Human' as const, text: 'q' },
      { speaker: 'Assistant' as const, text: 'a' },
    ],
  },
];

const render = (policy?: RenderIndexOptions['policy']) =>
  renderIndex(entries, {
    index: DEFAULT_CONFIG.index,
    projectColumn: false,
    carried: [],
    excluded: [],
    ...(policy ? { policy } : {}),
  });

/** The rules paragraph, as it is laid out in the file. */
const paragraph = (out: string) => {
  const start = out.indexOf('Each transcript');
  return out.slice(start, out.indexOf('\n\n', start));
};

/** The same paragraph, unwrapped, for asserting on its wording. */
const rules = (out: string) => paragraph(out).replace(/\n/g, ' ');

describe('the index describes the tool policy the transcripts were written under', () => {
  it('words the default exactly as before, line for line', () => {
    expect(render()).toBe(render({ tools: 'strip', keepTools: [] }));
    expect(paragraph(render())).toBe(
      [
        'Each transcript is one branch of its conversation. Where a reply was edited',
        'or regenerated, the latest version is shown, and `branches_dropped` in the',
        'frontmatter says how many others there were. A turn is one exchange, with',
        'consecutive assistant messages joined. Tool calls are stripped, except for',
        'documents Claude wrote, which appear in their final version, and questions it',
        'asked. Turn numbers are stable only while these rules are.',
      ].join('\n'),
    );
  });

  it('names the tools keepTools keeps', () => {
    expect(
      rules(
        render({ tools: 'strip', keepTools: ['conversation_search', 'web_search'] }),
      ),
    ).toContain(
      'questions it asked, and calls to `conversation_search` and `web_search`, ' +
        'which are kept with their results as JSON.',
    );
  });

  it('lists three or more kept tools with commas', () => {
    expect(rules(render({ tools: 'strip', keepTools: ['a', 'b', 'c'] }))).toContain(
      'calls to `a`, `b` and `c`,',
    );
  });

  it('says under tools: keep that everything is kept and nothing has a final version', () => {
    const text = rules(render({ tools: 'keep' }));
    expect(text).toContain('Every tool call is kept, with its result, as JSON');
    expect(text).toContain('not in a final version');
    expect(text).not.toContain('Tool calls are stripped');
  });

  it('wraps a configured wording at 78 columns', () => {
    const lines = paragraph(
      render({ tools: 'strip', keepTools: ['conversation_search', 'web_search'] }),
    ).split('\n');
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(78);
  });
});
