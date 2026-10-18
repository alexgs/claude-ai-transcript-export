/** Any uuid, wherever it sits on a line. */
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

export interface LinkList {
  /** Conversation uuids, lowercased, in first-seen order, without duplicates. */
  uuids: string[];
  /** Project uuids found and skipped, so the run can report them (§5.2). */
  skippedProjectUuids: string[];
}

/**
 * A link list's text, read generously (specification §5.2). Pure.
 *
 * It is meant to be pasted: a column of chat URLs off the project page, or
 * Claude's reply when asked inside the project for its conversations. So every
 * uuid on every line is collected, whatever surrounds it, and a line starting
 * with `#` is a comment. A uuid that is one of the export's projects is
 * skipped, since a pasted project URL carries one. The strict half, that
 * every remaining uuid must resolve, is `select`'s job, because it needs the
 * export and the output directory.
 */
export function parseLinkList(
  text: string,
  projectUuids: ReadonlySet<string> = new Set(),
): LinkList {
  const uuids: string[] = [];
  const seen = new Set<string>();
  const skipped = new Set<string>();

  for (const line of text.split(/\r?\n/)) {
    if (line.trimStart().startsWith('#')) continue;
    for (const match of line.matchAll(UUID)) {
      const uuid = match[0].toLowerCase();
      if (projectUuids.has(uuid)) {
        skipped.add(uuid);
        continue;
      }
      if (seen.has(uuid)) continue;
      seen.add(uuid);
      uuids.push(uuid);
    }
  }

  return { uuids, skippedProjectUuids: [...skipped] };
}
