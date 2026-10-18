import type { RawConversation } from './types.js';

/** The root message's parent, in every conversation observed (brief §6). */
export const ROOT_PARENT = '00000000-0000-4000-8000-000000000000';

/** Keys the specification expects on a conversation and on a message. */
const KNOWN_CONVERSATION_KEYS = new Set([
  'uuid',
  'name',
  'summary',
  'created_at',
  'updated_at',
  'account',
  'chat_messages',
]);
const KNOWN_MESSAGE_KEYS = new Set([
  'uuid',
  'parent_message_uuid',
  'sender',
  'text',
  'content',
  'attachments',
  'files',
  'created_at',
  'updated_at',
]);

/** Block types §7.1 says what to do with. */
const HANDLED_BLOCKS = new Set([
  'text',
  'thinking',
  'tool_use',
  'tool_result',
  'token_budget',
  'injected_prompt_block',
  'image',
  'document',
  'flag',
]);

export interface ProbeReport {
  conversations: number;
  /** Conversations with no messages. */
  emptyConversations: number;
  messages: number;
  senders: Record<string, number>;
  blockTypes: Record<string, number>;
  toolNames: Record<string, number>;
  /** Conversations with more than one leaf, and the fork points across them. */
  forkedConversations: number;
  forkPoints: number;
  /** Messages whose parent is neither the root sentinel nor in the conversation. */
  unknownParents: number;
  /** Keys outside what the specification expects; drift shows up here first. */
  unexpectedConversationKeys: string[];
  unexpectedMessageKeys: string[];
  unhandledBlocks: string[];
}

const bump = (counts: Map<string, number>, key: string) =>
  counts.set(key, (counts.get(key) ?? 0) + 1);

const sorted = (counts: Map<string, number>): Record<string, number> =>
  Object.fromEntries(
    [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
  );

/**
 * A schema report over every conversation in an export. Pure.
 *
 * It counts and names; it never prints a value out of a conversation. A probe
 * is something run on an account's whole history and pasted into an issue, so
 * the report has to be safe to paste.
 */
export function probeConversations(conversations: RawConversation[]): ProbeReport {
  const senders = new Map<string, number>();
  const blockTypes = new Map<string, number>();
  const toolNames = new Map<string, number>();
  const conversationKeys = new Set<string>();
  const messageKeys = new Set<string>();

  let emptyConversations = 0;
  let messages = 0;
  let forkedConversations = 0;
  let forkPoints = 0;
  let unknownParents = 0;

  for (const conversation of conversations) {
    for (const key of Object.keys(conversation)) conversationKeys.add(key);
    const chat = Array.isArray(conversation.chat_messages)
      ? conversation.chat_messages
      : [];
    if (chat.length === 0) emptyConversations += 1;
    messages += chat.length;

    const ids = new Set(chat.map((m) => m.uuid));
    const children = new Map<string, number>();

    for (const message of chat) {
      for (const key of Object.keys(message)) messageKeys.add(key);
      bump(senders, message.sender ?? '(none)');

      const parent = message.parent_message_uuid ?? '(none)';
      bump(children, parent);
      if (parent !== ROOT_PARENT && !ids.has(parent)) unknownParents += 1;

      for (const block of Array.isArray(message.content) ? message.content : []) {
        const type = block?.type ?? '(none)';
        bump(blockTypes, type);
        if (type === 'tool_use') bump(toolNames, block.name ?? '(none)');
      }
    }

    const forks = [...children.values()].filter((n) => n > 1).length;
    if (forks > 0) forkedConversations += 1;
    forkPoints += forks;
  }

  return {
    conversations: conversations.length,
    emptyConversations,
    messages,
    senders: sorted(senders),
    blockTypes: sorted(blockTypes),
    toolNames: sorted(toolNames),
    forkedConversations,
    forkPoints,
    unknownParents,
    unexpectedConversationKeys: [...conversationKeys]
      .filter((k) => !KNOWN_CONVERSATION_KEYS.has(k))
      .sort(),
    unexpectedMessageKeys: [...messageKeys]
      .filter((k) => !KNOWN_MESSAGE_KEYS.has(k))
      .sort(),
    unhandledBlocks: [...blockTypes.keys()]
      .filter((t) => !HANDLED_BLOCKS.has(t))
      .sort(),
  };
}

const table = (counts: Record<string, number>) =>
  Object.entries(counts).map(([key, n]) => `  ${String(n).padStart(7)}  ${key}`);

/** The report as text, for the terminal. */
export function formatProbe(report: ProbeReport): string {
  const lines = [
    `conversations: ${report.conversations} (${report.emptyConversations} with no messages)`,
    `messages: ${report.messages}`,
    `forked conversations: ${report.forkedConversations}, fork points: ${report.forkPoints}`,
    `messages with an unknown parent: ${report.unknownParents}`,
    '',
    'senders:',
    ...table(report.senders),
    '',
    'block types:',
    ...table(report.blockTypes),
    '',
    `tool names (${Object.keys(report.toolNames).length}):`,
    ...table(report.toolNames),
  ];

  const drift = [
    ['unhandled block types', report.unhandledBlocks],
    ['unexpected conversation keys', report.unexpectedConversationKeys],
    ['unexpected message keys', report.unexpectedMessageKeys],
  ] as const;

  lines.push('');
  if (drift.every(([, names]) => names.length === 0)) {
    lines.push('Nothing outside what the specification handles.');
  } else {
    for (const [label, names] of drift) {
      if (names.length > 0) lines.push(`${label}: ${names.join(', ')}`);
    }
  }

  return lines.join('\n');
}
