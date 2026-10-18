import { describe, expect, it } from 'vitest';
import { buildTurns } from '../src/turns.js';
import { chooseBranch } from '../src/tree.js';
import { linear, text, toolUse } from './factories.js';

const build = (c: ReturnType<typeof linear>) => buildTurns(chooseBranch(c).messages);

describe('buildTurns', () => {
  it('makes one turn per message in an alternating conversation', () => {
    const { turns } = build(
      linear([
        ['human', [text('q')]],
        ['assistant', [text('a')]],
      ]),
    );
    expect(turns).toEqual([
      { speaker: 'Human', text: 'q' },
      { speaker: 'Assistant', text: 'a' },
    ]);
  });

  it('coalesces consecutive assistant messages into one turn', () => {
    const { turns } = build(
      linear([
        ['human', [text('q')]],
        ['assistant', [text('part one')]],
        ['assistant', [text('part two')]],
      ]),
    );
    expect(turns).toEqual([
      { speaker: 'Human', text: 'q' },
      { speaker: 'Assistant', text: 'part one\n\npart two' },
    ]);
  });

  it('does not make an empty human message a turn, and coalesces across it', () => {
    const built = build(
      linear([
        ['human', [text('q')]],
        ['assistant', [text('one')]],
        ['human', []],
        ['assistant', [text('two')]],
      ]),
    );
    expect(built.turns.map((t) => t.speaker)).toEqual(['Human', 'Assistant']);
    expect(built.turns[1]?.text).toBe('one\n\ntwo');
    expect(built.emptyHumanMessages).toBe(1);
  });

  it('drops an assistant turn with nothing visible, leaving two human turns', () => {
    const { turns } = build(
      linear([
        ['human', [text('q1')]],
        ['assistant', [toolUse('bash_tool', { command: 'ls' })]],
        ['human', [text('q2')]],
      ]),
    );
    expect(turns.map((t) => t.speaker)).toEqual(['Human', 'Human']);
  });

  it('keeps a human message holding only a file, as a marker', () => {
    const c = linear([
      ['human', []],
      ['assistant', [text('seen')]],
    ]);
    c.chat_messages![0]!.files = [{ file_uuid: 'f', file_name: 'photo.jpg' }];
    expect(build(c).turns[0]).toEqual({
      speaker: 'Human',
      text: '> [file: photo.jpg]',
    });
  });

  it('falls back to text when content is empty, and counts it', () => {
    const c = linear([['human', []]]);
    c.chat_messages![0]!.text = 'from the text field';
    const built = build(c);
    expect(built.turns[0]?.text).toBe('from the text field');
    expect(built.textFallbacks).toBe(1);
  });

  it('lists a turn’s sources once each, after its prose', () => {
    const cite = (url: string) => ({ details: { url } });
    const { turns } = build(
      linear([
        ['human', [text('q')]],
        ['assistant', [text('one', { citations: [cite('https://a.example')] })]],
        [
          'assistant',
          [
            text('two', {
              citations: [cite('https://a.example'), cite('https://b.example')],
            }),
          ],
        ],
      ]),
    );
    expect(turns[1]?.text).toBe(
      'one\n\ntwo\n\nSources:\n- https://a.example\n- https://b.example',
    );
  });

  it('is an error for an unknown sender', () => {
    const c = linear([['human', [text('q')]]]);
    c.chat_messages![0]!.sender = 'system';
    expect(() => build(c)).toThrow(/sender "system"/);
  });
});
