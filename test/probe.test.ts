import { describe, expect, it } from 'vitest';
import { ROOT_PARENT, formatProbe, probeConversations } from '../src/probe.js';
import type { RawConversation, RawMessage } from '../src/types.js';

const message = (
  uuid: string,
  parent: string,
  extra: Partial<RawMessage> = {},
): RawMessage => ({
  uuid,
  parent_message_uuid: parent,
  sender: 'human',
  text: '',
  content: [],
  attachments: [],
  files: [],
  created_at: '2026-08-24T21:13:00Z',
  updated_at: '2026-08-24T21:13:00Z',
  ...extra,
});

const conversation = (chat: RawMessage[], extra: Partial<RawConversation> = {}) => ({
  uuid: 'c',
  name: 'n',
  summary: '',
  created_at: '2026-08-24T21:13:00Z',
  updated_at: '2026-08-24T21:13:00Z',
  account: {},
  chat_messages: chat,
  ...extra,
});

describe('probeConversations', () => {
  it('counts a fork once per branching parent', () => {
    const report = probeConversations([
      conversation([
        message('a', ROOT_PARENT),
        message('b', 'a', { sender: 'assistant' }),
        message('c', 'a', { sender: 'assistant' }),
        message('d', 'b'),
      ]),
      conversation([message('e', ROOT_PARENT)]),
    ]);
    expect(report.forkedConversations).toBe(1);
    expect(report.forkPoints).toBe(1);
    expect(report.senders).toEqual({ assistant: 2, human: 3 });
  });

  it('counts block types and tool names', () => {
    const report = probeConversations([
      conversation([
        message('a', ROOT_PARENT, {
          content: [
            { type: 'text', text: 'x' },
            { type: 'tool_use', name: 'create_file' },
            { type: 'tool_use', name: 'create_file' },
            { type: 'tool_result', name: 'create_file' },
          ],
        }),
      ]),
    ]);
    expect(report.blockTypes).toEqual({ tool_use: 2, text: 1, tool_result: 1 });
    expect(report.toolNames).toEqual({ create_file: 2 });
  });

  it('names a block type, conversation key or message key it does not expect', () => {
    const report = probeConversations([
      conversation(
        [message('a', ROOT_PARENT, { content: [{ type: 'hologram' }], mood: 1 })],
        {
          model: 'x',
        },
      ),
    ]);
    expect(report.unhandledBlocks).toEqual(['hologram']);
    expect(report.unexpectedConversationKeys).toEqual(['model']);
    expect(report.unexpectedMessageKeys).toEqual(['mood']);
    expect(formatProbe(report)).toContain('unhandled block types: hologram');
  });

  it('counts a message whose parent is not in the conversation', () => {
    const report = probeConversations([conversation([message('a', 'elsewhere')])]);
    expect(report.unknownParents).toBe(1);
  });

  it('counts conversations with no messages', () => {
    expect(probeConversations([conversation([])]).emptyConversations).toBe(1);
  });

  it('never prints a value from a conversation', () => {
    // A probe report gets pasted into issues, so it must be safe to paste.
    const report = probeConversations([
      conversation(
        [
          message('a', ROOT_PARENT, {
            text: 'SECRET',
            content: [{ type: 'text', text: 'SECRET' }],
          }),
        ],
        { name: 'SECRET TITLE' },
      ),
    ]);
    expect(formatProbe(report)).not.toContain('SECRET');
    expect(JSON.stringify(report)).not.toContain('SECRET');
  });
});
