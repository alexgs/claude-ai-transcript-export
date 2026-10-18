import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  pruneExcluded,
  pruneRenamed,
  readTranscripts,
  renderTranscript,
  sessionFilename,
  slugify,
  writeIfChanged,
  writePlainIfChanged,
  type CarriedTranscript,
} from '@alexgsdev/claude-code-transcript-export';
import { contentPolicy, type ResolvedConfig } from './config.js';
import { toTranscript } from './conversation.js';
import type { ExportInput } from './input.js';
import { renderIndex, type IndexEntry } from './render/index.js';
import { select, type ProjectCount, type Selection } from './select.js';
import type { ContentPolicy } from './types.js';

/**
 * The selection for a config against an export: reads the link lists, and
 * takes the transcripts already on disk from the caller, which reads them
 * once, before anything is written.
 */
export function resolveSelection(
  input: ExportInput,
  resolved: ResolvedConfig,
  onDisk: CarriedTranscript[],
): Selection {
  const { root, config } = resolved;
  const lists = new Map<string, string>();
  for (const project of config.projects) {
    const path = resolve(root, project.list);
    // An unreadable list is reported by `select`, with every other problem.
    if (existsSync(path)) lists.set(project.name, readFileSync(path, 'utf8'));
  }
  return select({
    conversations: input.conversations,
    projectUuids: input.projectUuids,
    config,
    lists,
    onDisk: new Set(onDisk.map((t) => t.id.toLowerCase())),
  });
}

export interface ExtractOptions {
  input: ExportInput;
  resolved: ResolvedConfig;
  /** `YYYY-MM-DD`. Injected: the CLI owns the only clock read. */
  today: string;
  dryRun?: boolean;
  /** Overrides the config's output directory, relative to the root. */
  out?: string;
  /** Command-line overrides of the config's content policy. */
  policy?: Partial<ContentPolicy>;
}

export interface ExtractSummary {
  root: string;
  outDir: string;
  /** Conversations selected and in this export. */
  conversations: number;
  written: number;
  unchanged: number;
  turns: number;
  branchesDropped: number;
  projects: ProjectCount[];
  titles: Selection['titles'];
  skippedProjectUuids: string[];
  /** Transcripts on disk this run did not regenerate, kept in the index. */
  carried: Array<{ id: string; title: string; filename: string }>;
  /** Carried ones whose conversation is in the export but no longer selected (§10.3). */
  deselected: Array<{ id: string; title: string; filename: string }>;
  skipped: Array<{ id: string; title: string; reason: 'empty' }>;
  removed: Array<{ name: string; reason: 'renamed' | 'excluded' }>;
  /** Documents whose replay failed, by conversation (§7.3). */
  documentsFellBack: Array<{ id: string; documents: string[] }>;
}

/** The whole run (specification §9, §10). */
export function extract(options: ExtractOptions): ExtractSummary {
  const { input, resolved } = options;
  const { root, config } = resolved;
  const outDir = resolve(root, options.out ?? config.out);
  const policy: ContentPolicy = { ...contentPolicy(config), ...options.policy };

  // Before anything is written, so this is what earlier runs left, and a dry
  // run reports it truthfully. It decides both which uuids a link list may
  // name without the export holding them, and which rows the index carries.
  const onDisk = readTranscripts(outDir);
  const selection = resolveSelection(input, resolved, onDisk);

  const summary: ExtractSummary = {
    root,
    outDir,
    conversations: 0,
    written: 0,
    unchanged: 0,
    turns: 0,
    branchesDropped: 0,
    projects: selection.projects,
    titles: selection.titles,
    skippedProjectUuids: selection.skippedProjectUuids,
    carried: [],
    deselected: [],
    skipped: [],
    removed: [],
    documentsFellBack: [],
  };

  const transcripts = selection.selected
    .filter((s) => s.conversation !== undefined)
    .map((s) => ({
      selected: s,
      t: toTranscript(s.conversation!, { policy, project: s.project }),
    }))
    .filter(({ t }) => {
      if (config.skipEmpty && t.session.turns.length === 0) {
        summary.skipped.push({
          id: t.session.id,
          title: t.session.title,
          reason: 'empty',
        });
        return false;
      }
      return true;
    });

  summary.conversations = transcripts.length;
  for (const { t } of transcripts) {
    summary.turns += t.session.turns.length;
    summary.branchesDropped += t.branchesDropped;
    const fell = t.built.documents?.fellBack ?? [];
    if (fell.length > 0)
      summary.documentsFellBack.push({ id: t.session.id, documents: fell });
  }

  const regenerated = new Set(transcripts.map(({ t }) => t.session.id));
  const exclude = new Set(config.exclude);
  const inExport = new Set(
    input.conversations.map((c) => (c.uuid ?? '').toLowerCase()),
  );
  const selectedIds = new Set(selection.selected.map((s) => s.uuid));

  // Carried: on disk, not regenerated, not excluded. That covers a
  // conversation deleted on claude.ai since an earlier export, and one taken
  // out of a link list, which is kept rather than deleted (§10.3): removing a
  // pasted line is too easy to do by accident to be how a committed
  // transcript is destroyed.
  const carried = onDisk.filter((c) => {
    const id = c.id.toLowerCase();
    return !regenerated.has(id) && !exclude.has(id);
  });
  summary.carried = carried.map((c) => ({
    id: c.id,
    title: c.title,
    filename: c.filename,
  }));
  summary.deselected = summary.carried.filter(
    (c) => inExport.has(c.id.toLowerCase()) && !selectedIds.has(c.id.toLowerCase()),
  );

  if (options.dryRun === true) return summary;

  mkdirSync(outDir, { recursive: true });

  // Every name this run stands behind, written or unchanged: pruneRenamed
  // must not treat an unchanged file as a superseded name.
  const names: string[] = [];
  for (const { t } of transcripts) {
    const name = sessionFilename(t.session, slugify);
    const wrote = writeIfChanged(
      join(outDir, name),
      (extractedOn) =>
        renderTranscript(t.session, {
          extractedOn,
          source: 'claude-ai',
          fields: t.fields,
          ...(t.project !== undefined ? { project: t.project } : {}),
        }),
      options.today,
    );
    if (wrote) summary.written += 1;
    else summary.unchanged += 1;
    names.push(name);
  }

  if (config.index.enabled) {
    const entries: IndexEntry[] = transcripts.map(({ t }) => ({
      id: t.session.id,
      title: t.session.title,
      created: t.session.created,
      turns: t.session.turns,
      ...(t.project !== undefined ? { project: t.project } : {}),
    }));
    const wrote = writePlainIfChanged(
      join(outDir, 'index.md'),
      renderIndex(entries, {
        index: config.index,
        projectColumn: config.projects.length > 1,
        carried,
        excluded: [...exclude].sort(),
        policy,
      }),
    );
    if (wrote) summary.written += 1;
    else summary.unchanged += 1;
    names.push('index.md');
  }

  // After the writes, so a name this run produced is never a candidate.
  for (const name of pruneRenamed(outDir, names))
    summary.removed.push({ name, reason: 'renamed' });
  for (const name of pruneExcluded(outDir, config.exclude)) {
    if (!summary.removed.some((r) => r.name === name)) {
      summary.removed.push({ name, reason: 'excluded' });
    }
  }

  return summary;
}
