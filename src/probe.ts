import {
  aggregateParity,
  parityReport,
  type ParityReport,
} from '@alexgsdev/claude-code-transcript-export';
import { ROOT_PARENT, chooseBranch } from './tree.js';
import { buildTurns } from './turns.js';
import type { RawConversation } from './types.js';

export { ROOT_PARENT };

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
  /**
   * The turn model over every conversation, under the default policy: what a
   * full extraction would produce (specification §6).
   */
  turnModel: {
    turns: number;
    /** Adjacent same-speaker turns on the chosen branches, as cctx measures them. */
    alternationBreaks: number;
    notStartingWithHuman: number;
    emptyHumanMessages: number;
    textFallbacks: number;
    branchesDropped: number;
    /** Conversations whose tree or senders could not be read. */
    unreadable: number;
  };
  /** The document model over every conversation (specification §7.3). */
  documents: {
    documents: number;
    replayed: number;
    fellBack: number;
    shellTouched: number;
    looseEdits: number;
    edits: { applied: number; unmatched: number; ambiguous: number };
  };
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
  const parities: ParityReport[] = [];
  let emptyHumanMessages = 0;
  let textFallbacks = 0;
  let branchesDropped = 0;
  let unreadable = 0;
  const documents = {
    documents: 0,
    replayed: 0,
    fellBack: 0,
    shellTouched: 0,
    looseEdits: 0,
    edits: { applied: 0, unmatched: 0, ambiguous: 0 },
  };

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

    try {
      const branch = chooseBranch(conversation);
      const built = buildTurns(branch.messages);
      branchesDropped += branch.branchesDropped;
      emptyHumanMessages += built.emptyHumanMessages;
      textFallbacks += built.textFallbacks;
      if (built.turns.length > 0) parities.push(parityReport(built.turns));
      const d = built.documents;
      if (d !== null) {
        documents.documents += d.documents;
        documents.replayed += d.replayed;
        documents.fellBack += d.fellBack.length;
        documents.shellTouched += d.shellTouched;
        documents.looseEdits += d.looseEdits;
        documents.edits.applied += d.edits.applied;
        documents.edits.unmatched += d.edits.unmatched;
        documents.edits.ambiguous += d.edits.ambiguous;
      }
    } catch (cause) {
      // A probe reports drift; it does not stop at the first instance of it.
      // A tree that cannot be walked or an unknown sender is exactly that.
      if (!(cause instanceof Error)) throw cause;
      unreadable += 1;
    }
  }

  const parity = aggregateParity(parities);

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
    turnModel: {
      turns: parity.turns,
      alternationBreaks: parity.alternationBreaks,
      notStartingWithHuman: parity.sessionsNotStartingWithHuman,
      emptyHumanMessages,
      textFallbacks,
      branchesDropped,
      unreadable,
    },
    documents,
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
    'turn model, on the chosen branches:',
    `  turns: ${report.turnModel.turns}`,
    `  alternation breaks: ${report.turnModel.alternationBreaks}`,
    `  conversations not starting with a human turn: ${report.turnModel.notStartingWithHuman}`,
    `  empty human messages (not turns): ${report.turnModel.emptyHumanMessages}`,
    `  messages rendered from text: ${report.turnModel.textFallbacks}`,
    `  branches dropped: ${report.turnModel.branchesDropped}`,
    `  unreadable conversations: ${report.turnModel.unreadable}`,
    '',
    'documents (create_file, str_replace, artifacts):',
    `  documents: ${report.documents.documents}`,
    `  replayed to a final version: ${report.documents.replayed}`,
    `  fell back to created text and diffs: ${report.documents.fellBack}`,
    `  touched by shell commands: ${report.documents.shellTouched}`,
    `  edits to files never created here: ${report.documents.looseEdits}`,
    `  file edits applied / unmatched / ambiguous: ${report.documents.edits.applied} / ` +
      `${report.documents.edits.unmatched} / ${report.documents.edits.ambiguous}`,
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
