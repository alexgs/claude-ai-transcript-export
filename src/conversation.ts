import {
  toLocalDate,
  type TranscriptSession,
} from '@alexgsdev/claude-code-transcript-export';
import type { ProjectConfig } from './config.js';
import { chooseBranch } from './tree.js';
import { buildTurns, type BuiltTurns } from './turns.js';
import type { ContentPolicy, RawConversation } from './types.js';

/** A conversation, ready for the cctx library to render and write. */
export interface ConversationTranscript {
  session: TranscriptSession;
  /** The library's `project` frontmatter key: here, the claude.ai project's name. */
  project?: string;
  /** Frontmatter after the library's own keys, through its `fields` option (§8.2). */
  fields: Record<string, unknown>;
  built: BuiltTurns;
  branchesDropped: number;
}

export const conversationUrl = (uuid: string) => `https://claude.ai/chat/${uuid}`;

/**
 * A derived title: the first line of the first human turn, cut at the last
 * word boundary before 80 characters (§8.3). Recorded as derived, so it is not
 * mistaken for a name the author or claude.ai gave the conversation.
 */
export function deriveTitle(firstHumanText: string | undefined): string {
  const line = (firstHumanText ?? '')
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l !== '');
  if (line === undefined) return 'Untitled conversation';
  if (line.length <= 80) return line;
  const cut = line.slice(0, 80);
  const space = cut.lastIndexOf(' ');
  return `${(space > 20 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** One conversation as a transcript (specification §6, §8). Pure. */
export function toTranscript(
  conversation: RawConversation,
  options: { policy: ContentPolicy; project: ProjectConfig | null },
): ConversationTranscript {
  const uuid = (conversation.uuid ?? '').toLowerCase();
  const branch = chooseBranch(conversation);
  const built = buildTurns(branch.messages, options.policy);

  const name = conversation.name?.trim() ?? '';
  const derived = name === '';
  const title = derived
    ? deriveTitle(built.turns.find((t) => t.speaker === 'Human')?.text)
    : name;

  const created = toLocalDate(conversation.created_at);
  // The last message on the rendered branch, not the conversation's
  // updated_at: that can move with no change to what is rendered (a later
  // abandoned branch, a rename), and a field that moves without the content
  // rewrites the file for nothing (§8.2, §9).
  const last = branch.messages[branch.messages.length - 1];
  const updated = last === undefined ? created : toLocalDate(last.created_at);

  const fields: Record<string, unknown> = { url: conversationUrl(uuid) };
  if (options.project?.uuid !== undefined) fields.project_uuid = options.project.uuid;
  if (derived) fields.title_derived = true;
  if (branch.branchesDropped > 0) fields.branches_dropped = branch.branchesDropped;

  const transcript: ConversationTranscript = {
    session: { id: uuid, title, created, updated, turns: built.turns },
    fields,
    built,
    branchesDropped: branch.branchesDropped,
  };
  if (options.project !== null) transcript.project = options.project.name;
  return transcript;
}
