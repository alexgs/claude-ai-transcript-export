import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readTranscripts, toLocalDate } from '@alexgsdev/claude-code-transcript-export';
import type { ResolvedConfig } from '../config.js';
import type { ExportInput } from '../input.js';
import { select, type Selection } from '../select.js';
import type { RawConversation } from '../types.js';

export interface ListRow {
  uuid: string;
  created: string;
  title: string;
  messages: number;
  forks: boolean;
  status: string;
}

/**
 * The selection for a config against an export, reading the link lists and
 * the output directory. The I/O half of `select`, shared by `list` and
 * `extract`.
 */
export function resolveSelection(
  input: ExportInput,
  resolved: ResolvedConfig,
): Selection {
  const { root, config } = resolved;
  const lists = new Map<string, string>();
  for (const project of config.projects) {
    const path = resolve(root, project.list);
    // A list that cannot be read is reported by `select` with the others.
    if (existsSync(path)) lists.set(project.name, readFileSync(path, 'utf8'));
  }
  const onDisk = new Set(
    readTranscripts(resolve(root, config.out)).map((t) => t.id.toLowerCase()),
  );
  return select({
    conversations: input.conversations,
    projectUuids: input.projectUuids,
    config,
    lists,
    onDisk,
  });
}

const forks = (c: RawConversation) => {
  const parents = new Map<string, number>();
  for (const m of c.chat_messages ?? []) {
    const p = m.parent_message_uuid ?? '';
    parents.set(p, (parents.get(p) ?? 0) + 1);
  }
  return [...parents.values()].some((n) => n > 1);
};

/** Every conversation in the export, with its status (specification §11.2). */
export function listRows(
  conversations: RawConversation[],
  selection: Selection | null,
  exclude: ReadonlySet<string>,
): ListRow[] {
  const status = new Map<string, string>();
  for (const s of selection?.selected ?? []) {
    status.set(s.uuid, s.project ? `selected: ${s.project.name}` : 'selected');
  }
  return conversations
    .filter((c) => typeof c.uuid === 'string')
    .map((c) => {
      const uuid = (c.uuid as string).toLowerCase();
      return {
        uuid,
        created: toLocalDate(c.created_at),
        title: c.name?.trim() || '(untitled)',
        messages: c.chat_messages?.length ?? 0,
        forks: forks(c),
        status: status.get(uuid) ?? (exclude.has(uuid) ? 'excluded' : 'not selected'),
        at: c.created_at ?? '',
      };
    })
    .sort((a, b) => a.at.localeCompare(b.at) || a.uuid.localeCompare(b.uuid))
    .map(({ at: _at, ...row }) => row);
}

export function formatRows(rows: ListRow[]): string {
  return rows
    .map(
      (r) =>
        `${r.uuid}  ${r.created}  ${String(r.messages).padStart(4)} msgs  ` +
        `${r.forks ? 'forks' : '     '}  ${r.status.padEnd(14)}  ${r.title}`,
    )
    .join('\n');
}
