import { describe, expect, it } from 'vitest';
import { toLocalDate } from '@alexgsdev/claude-code-transcript-export';
import { deriveTitle, toTranscript } from '../src/conversation.js';
import { DEFAULT_CONTENT_POLICY } from '../src/types.js';
import { ROOT_PARENT } from '../src/tree.js';
import { conversation, linear, message, text } from './factories.js';

const opts = { policy: DEFAULT_CONTENT_POLICY, project: null };

describe('toTranscript', () => {
  it('builds the session and frontmatter fields', () => {
    const t = toTranscript(
      linear([
        ['human', [text('q')]],
        ['assistant', [text('a')]],
      ]),
      {
        policy: DEFAULT_CONTENT_POLICY,
        project: {
          name: 'P',
          uuid: '0190f1c5-0000-7000-8000-000000000001',
          list: 'p.txt',
        },
      },
    );
    expect(t.session).toMatchObject({
      id: 'c0ffee00-0000-4000-8000-000000000001',
      title: 'A conversation',
    });
    expect(t.project).toBe('P');
    expect(t.fields).toEqual({
      url: 'https://claude.ai/chat/c0ffee00-0000-4000-8000-000000000001',
      project_uuid: '0190f1c5-0000-7000-8000-000000000001',
    });
  });

  it('dates updated from the last message on the branch, not updated_at', () => {
    const c = linear(
      [
        ['human', [text('q')]],
        ['assistant', [text('a')]],
      ],
      {
        updated_at: '2030-01-01T12:00:00Z',
      },
    );
    const last = c.chat_messages![1]!.created_at;
    expect(toTranscript(c, opts).session.updated).toBe(toLocalDate(last));
  });

  it('records dropped branches', () => {
    const a = message('a', ROOT_PARENT, 'human', [text('q')]);
    const x = message('x', 'a', 'assistant', [text('one')]);
    const y = message('y', 'a', 'assistant', [text('two')]);
    expect(toTranscript(conversation([a, x, y]), opts).fields.branches_dropped).toBe(1);
  });

  it('derives a title from the first human turn, and says so', () => {
    const t = toTranscript(
      linear([['human', [text('\n  How do jump limits work?\nMore.')]]], {
        name: '  ',
      }),
      opts,
    );
    expect(t.session.title).toBe('How do jump limits work?');
    expect(t.fields.title_derived).toBe(true);
  });

  it('never records the account uuid', () => {
    const t = toTranscript(
      linear([['human', [text('q')]]], { account: { uuid: 'ACCOUNT-SECRET' } }),
      opts,
    );
    expect(JSON.stringify(t)).not.toContain('ACCOUNT-SECRET');
  });
});

describe('deriveTitle', () => {
  it('cuts at a word boundary before 80 characters', () => {
    const long = 'word '.repeat(30).trim();
    const title = deriveTitle(long);
    expect(title.length).toBeLessThanOrEqual(81);
    expect(title.endsWith('word…')).toBe(true);
  });

  it('falls back when there is no human text', () => {
    expect(deriveTitle(undefined)).toBe('Untitled conversation');
  });
});
