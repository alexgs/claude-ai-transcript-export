import type { RawBlock, RawConversation, RawMessage } from '../src/types.js';
import { ROOT_PARENT } from '../src/tree.js';

/**
 * Builders for synthetic conversations, shaped like the real export (brief
 * §3). Times default to one minute apart in creation order, so a test that
 * cares about "latest" says so explicitly.
 */
let clock = Date.parse('2026-08-24T21:00:00Z');
const next = () => new Date((clock += 60_000)).toISOString();

export const text = (t: string, extra: Partial<RawBlock> = {}): RawBlock => ({
  type: 'text',
  text: t,
  citations: [],
  ...extra,
});

export const toolUse = (name: string, input: unknown, id = `tu-${name}`): RawBlock => ({
  type: 'tool_use',
  name,
  id,
  input,
});

export const toolResult = (
  name: string,
  content: unknown,
  id = `tu-${name}`,
): RawBlock => ({
  type: 'tool_result',
  name,
  tool_use_id: id,
  content,
  is_error: false,
});

export function message(
  uuid: string,
  parent: string,
  sender: 'human' | 'assistant',
  content: RawBlock[],
  extra: Partial<RawMessage> = {},
): RawMessage {
  const at = next();
  return {
    uuid,
    parent_message_uuid: parent,
    sender,
    text: '',
    content,
    attachments: [],
    files: [],
    created_at: at,
    updated_at: at,
    ...extra,
  };
}

/** A linear conversation: alternating senders unless a message says otherwise. */
export function linear(
  turns: Array<[sender: 'human' | 'assistant', content: RawBlock[]]>,
  extra: Partial<RawConversation> = {},
): RawConversation {
  let parent = ROOT_PARENT;
  const chat = turns.map(([sender, content], i) => {
    const m = message(`m${i}`, parent, sender, content);
    parent = m.uuid as string;
    return m;
  });
  return conversation(chat, extra);
}

export function conversation(
  chat: RawMessage[],
  extra: Partial<RawConversation> = {},
): RawConversation {
  return {
    uuid: 'c0ffee00-0000-4000-8000-000000000001',
    name: 'A conversation',
    summary: '',
    created_at: chat[0]?.created_at ?? '2026-08-24T21:00:00Z',
    updated_at: chat[chat.length - 1]?.updated_at ?? '2026-08-24T21:00:00Z',
    account: { uuid: 'acc' },
    chat_messages: chat,
    ...extra,
  };
}
