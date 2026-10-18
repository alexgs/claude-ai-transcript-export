import { toLocalDate } from '@alexgsdev/claude-code-transcript-export';
import type { Selection } from '../select.js';
import type { RawConversation } from '../types.js';

export interface ListRow {
  uuid: string;
  created: string;
  title: string;
  messages: number;
  forks: boolean;
  status: string;
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
