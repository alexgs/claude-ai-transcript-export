import { describe, expect, it } from 'vitest';
import { ROOT_PARENT, TreeError, chooseBranch } from '../src/tree.js';
import { conversation, message, text } from './factories.js';

const ids = (c: ReturnType<typeof conversation>) =>
  chooseBranch(c).messages.map((m) => m.uuid);

describe('chooseBranch', () => {
  it('follows a linear conversation root to leaf', () => {
    const a = message('a', ROOT_PARENT, 'human', [text('q')]);
    const b = message('b', 'a', 'assistant', [text('r')]);
    expect(ids(conversation([a, b]))).toEqual(['a', 'b']);
    expect(chooseBranch(conversation([a, b])).branchesDropped).toBe(0);
  });

  it('follows the latest-created leaf, not array order', () => {
    // A regenerated reply: two assistant children of one prompt. The array
    // lists the newer one first, as an interleaved export can.
    const a = message('a', ROOT_PARENT, 'human', [text('q')]);
    const old = message('old', 'a', 'assistant', [text('first try')], {
      created_at: '2026-08-24T21:01:00Z',
    });
    const fresh = message('new', 'a', 'assistant', [text('second try')], {
      created_at: '2026-08-24T21:05:00Z',
    });
    expect(ids(conversation([a, fresh, old]))).toEqual(['a', 'new']);
  });

  it('breaks a tie toward the leaf later in the array', () => {
    const at = '2026-08-24T21:01:00Z';
    const a = message('a', ROOT_PARENT, 'human', [text('q')]);
    const x = message('x', 'a', 'assistant', [text('x')], { created_at: at });
    const y = message('y', 'a', 'assistant', [text('y')], { created_at: at });
    expect(ids(conversation([a, x, y]))).toEqual(['a', 'y']);
  });

  it('counts the leaves it did not choose', () => {
    const a = message('a', ROOT_PARENT, 'human', [text('q')]);
    const kids = ['x', 'y', 'z'].map((id) => message(id, 'a', 'assistant', [text(id)]));
    expect(chooseBranch(conversation([a, ...kids])).branchesDropped).toBe(2);
  });

  it('is an error naming the conversation when a parent is missing', () => {
    const a = message('a', 'nowhere', 'human', [text('q')]);
    expect(() => chooseBranch(conversation([a]))).toThrow(TreeError);
    expect(() => chooseBranch(conversation([a]))).toThrow(/c0ffee00/);
  });

  it('is an error for a cycle rather than a hang', () => {
    const a = message('a', 'b', 'human', [text('q')]);
    const b = message('b', 'a', 'assistant', [text('r')]);
    // Every message has a child, so there is no leaf to start from at all.
    expect(() => chooseBranch(conversation([a, b]))).toThrow(TreeError);
  });

  it('returns nothing for a conversation with no messages', () => {
    expect(chooseBranch(conversation([]))).toEqual({
      messages: [],
      branchesDropped: 0,
    });
  });
});
