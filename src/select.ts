import { UsageError } from '@alexgsdev/claude-code-transcript-export';
import type { Config, ConversationEntry, ProjectConfig } from './config.js';
import { parseLinkList } from './linklist.js';
import type { RawConversation } from './types.js';

/** One selected conversation. */
export interface Selected {
  uuid: string;
  /** Absent when the conversation is not in this export: its transcript is carried. */
  conversation?: RawConversation;
  project: ProjectConfig | null;
  note?: string;
}

export interface ProjectCount {
  name: string;
  /** Distinct conversations the list resolved to, excluded ones removed. */
  total: number;
  inExport: number;
  carried: number;
}

export interface Selection {
  /** In export order, then carried ones in list order. */
  selected: Selected[];
  /** Per project, printed every run: the only check on a list missing chats (§5.2). */
  projects: ProjectCount[];
  /** Project uuids found in link lists and skipped. */
  skippedProjectUuids: string[];
  /** Title selectors and the uuid each resolved to, for the run to print (§5.3). */
  titles: Array<{ title: string; uuid: string }>;
  /** Selected-but-excluded uuids: `exclude` wins over every selector. */
  excluded: string[];
}

export interface SelectInput {
  conversations: RawConversation[];
  projectUuids: string[];
  config: Config;
  /** Each project's link list text, by project name. */
  lists: ReadonlyMap<string, string>;
  /** Conversation uuids with a transcript already in the output directory. */
  onDisk: ReadonlySet<string>;
}

/**
 * Which conversations a run writes (specification §5.1–§5.3). Pure.
 *
 * Generous reading is in `parseLinkList`; this is the strict half. Every
 * problem is collected before throwing, so one run names all of them rather
 * than one per attempt.
 */
export function select(input: SelectInput): Selection {
  const { config } = input;
  const byUuid = new Map<string, RawConversation>();
  for (const c of input.conversations) {
    if (typeof c.uuid === 'string') byUuid.set(c.uuid.toLowerCase(), c);
  }
  const projectSet = new Set(input.projectUuids.map((u) => u.toLowerCase()));
  const exclude = new Set(config.exclude);
  const problems: string[] = [];

  const owner = new Map<string, ProjectConfig>();
  const skipped = new Set<string>();
  const counts: ProjectCount[] = [];

  for (const project of config.projects) {
    const text = input.lists.get(project.name);
    if (text === undefined) {
      problems.push(
        `project ${project.name}: its list ${project.list} could not be read.`,
      );
      continue;
    }
    const list = parseLinkList(text, projectSet);
    for (const u of list.skippedProjectUuids) skipped.add(u);

    const count: ProjectCount = {
      name: project.name,
      total: 0,
      inExport: 0,
      carried: 0,
    };
    const unknown: string[] = [];
    for (const uuid of list.uuids) {
      const other = owner.get(uuid);
      if (other !== undefined && other !== project) {
        // claude.ai puts a conversation in at most one project, so two lists
        // naming it means one list is wrong.
        problems.push(
          `conversation ${uuid} is in both ${other.name} and ${project.name}.`,
        );
        continue;
      }
      if (!byUuid.has(uuid) && !input.onDisk.has(uuid)) {
        unknown.push(uuid);
        continue;
      }
      owner.set(uuid, project);
      if (exclude.has(uuid)) continue;
      count.total += 1;
      if (byUuid.has(uuid)) count.inExport += 1;
      else count.carried += 1;
    }
    if (unknown.length > 0) {
      // Mistyped, copied from the wrong place, or made up by the model asked
      // for the list. Nothing is written while any of these stand.
      problems.push(
        `project ${project.name}: ${unknown.length} uuid${unknown.length === 1 ? '' : 's'} in ` +
          `${project.list} ${unknown.length === 1 ? 'is' : 'are'} neither a conversation in this ` +
          `export nor a transcript already written: ${unknown.join(', ')}`,
      );
    }
    counts.push(count);
  }

  const notes = new Map<string, string>();
  const single = new Set<string>();
  const titles: Selection['titles'] = [];

  for (const entry of config.conversations) {
    const uuid = resolveEntry(
      entry,
      input.conversations,
      byUuid,
      input.onDisk,
      problems,
    );
    if (uuid === null) continue;
    if (entry.title !== undefined) titles.push({ title: entry.title, uuid });
    single.add(uuid);
    if (entry.note !== undefined) notes.set(uuid, entry.note);
  }

  if (problems.length > 0) {
    throw new UsageError(
      `the selection has ${problems.length === 1 ? 'a problem' : `${problems.length} problems`}; ` +
        `nothing was written.\n  ${problems.join('\n  ')}`,
    );
  }

  const chosen = new Set([...owner.keys(), ...single]);
  const excluded = [...chosen].filter((u) => exclude.has(u)).sort();
  const make = (uuid: string): Selected => {
    const s: Selected = { uuid, project: owner.get(uuid) ?? null };
    const conversation = byUuid.get(uuid);
    if (conversation !== undefined) s.conversation = conversation;
    const note = notes.get(uuid) ?? owner.get(uuid)?.note;
    if (note !== undefined) s.note = note;
    return s;
  };

  const selected = [
    ...input.conversations
      .map((c) => (typeof c.uuid === 'string' ? c.uuid.toLowerCase() : ''))
      .filter((u) => chosen.has(u) && !exclude.has(u)),
    ...[...chosen].filter((u) => !byUuid.has(u) && !exclude.has(u)),
  ].map(make);

  return {
    selected,
    projects: counts,
    skippedProjectUuids: [...skipped].sort(),
    titles,
    excluded,
  };
}

function resolveEntry(
  entry: ConversationEntry,
  conversations: RawConversation[],
  byUuid: Map<string, RawConversation>,
  onDisk: ReadonlySet<string>,
  problems: string[],
): string | null {
  if (entry.uuid !== undefined) {
    if (byUuid.has(entry.uuid) || onDisk.has(entry.uuid)) return entry.uuid;
    problems.push(
      `conversations: ${entry.uuid} is neither in this export nor a transcript already written.`,
    );
    return null;
  }
  const wanted = (entry.title as string).toLowerCase();
  const matches = conversations.filter(
    (c) => typeof c.name === 'string' && c.name.trim().toLowerCase() === wanted,
  );
  if (matches.length === 1 && typeof matches[0]?.uuid === 'string') {
    return matches[0].uuid.toLowerCase();
  }
  problems.push(
    matches.length === 0
      ? `conversations: no conversation is titled ${JSON.stringify(entry.title)}.`
      : `conversations: ${matches.length} conversations are titled ${JSON.stringify(entry.title)}; ` +
          `name one by uuid: ${matches.map((c) => c.uuid).join(', ')}`,
  );
  return null;
}
