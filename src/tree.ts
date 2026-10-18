import type { RawConversation, RawMessage } from './types.js';

/** The root message's parent, in every conversation observed (brief §6). */
export const ROOT_PARENT = '00000000-0000-4000-8000-000000000000';

/** One path through a conversation's tree. */
export interface Branch {
  /** Root to leaf, in order. */
  messages: RawMessage[];
  /** Leaves other than the chosen one; 0 for a conversation that never forks. */
  branchesDropped: number;
}

/** A conversation whose tree cannot be walked: the export format moved. */
export class TreeError extends Error {}

/**
 * The branch a transcript renders: the path from the root to the
 * latest-created leaf (specification §6.1).
 *
 * The array order of `chat_messages` interleaves branches, one adjacent
 * same-sender pair per fork point in the observed export, so rendering it as
 * it stands would stitch abandoned replies into the transcript. The export
 * marks no current branch. The latest leaf is the rule, and ties break toward
 * the leaf later in the array; across all 87 forked conversations observed the
 * two never disagree.
 */
export function chooseBranch(conversation: RawConversation): Branch {
  const chat = Array.isArray(conversation.chat_messages)
    ? conversation.chat_messages
    : [];
  if (chat.length === 0) return { messages: [], branchesDropped: 0 };

  const label = conversation.uuid ?? '(no uuid)';
  const byId = new Map<string, RawMessage>();
  for (const message of chat) {
    if (typeof message.uuid === 'string') byId.set(message.uuid, message);
  }

  const parents = new Set<string>();
  for (const message of chat) {
    const parent = message.parent_message_uuid;
    // A parent that is neither the root nor in this conversation means the
    // format changed. Failing loudly beats rendering a fragment.
    if (parent !== ROOT_PARENT && (parent === undefined || !byId.has(parent))) {
      throw new TreeError(
        `conversation ${label}: message ${message.uuid ?? '(no uuid)'} has a parent ` +
          'that is not in the conversation. Run `caitx probe` on this export.',
      );
    }
    parents.add(parent);
  }

  const leaves = chat
    .map((message, index) => ({ message, index }))
    .filter(({ message }) => message.uuid === undefined || !parents.has(message.uuid));

  if (leaves.length === 0) {
    // Every message has a child, so the parent links loop.
    throw new TreeError(`conversation ${label}: its messages form a cycle.`);
  }

  const time = (m: RawMessage) => {
    const t = Date.parse(m.created_at ?? '');
    return Number.isNaN(t) ? -Infinity : t;
  };
  let chosen = leaves[0] as { message: RawMessage; index: number };
  for (const leaf of leaves.slice(1)) {
    const a = time(leaf.message);
    const b = time(chosen.message);
    if (a > b || (a === b && leaf.index > chosen.index)) chosen = leaf;
  }

  const path: RawMessage[] = [];
  const seen = new Set<RawMessage>();
  for (let cur: RawMessage | undefined = chosen.message; cur !== undefined;) {
    if (seen.has(cur)) {
      throw new TreeError(`conversation ${label}: its messages form a cycle.`);
    }
    seen.add(cur);
    path.push(cur);
    const parent: string | undefined = cur.parent_message_uuid;
    cur = parent === ROOT_PARENT || parent === undefined ? undefined : byId.get(parent);
  }

  return { messages: path.reverse(), branchesDropped: leaves.length - 1 };
}
