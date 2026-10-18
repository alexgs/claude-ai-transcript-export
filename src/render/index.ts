import {
  parityStatement,
  type CarriedTranscript,
  type SessionTurn,
} from '@alexgsdev/claude-code-transcript-export';
import type { IndexConfig } from '../config.js';
import type { ContentPolicy } from '../types.js';
import { conversationUrl } from '../conversation.js';

/** A regenerated conversation's row. */
export interface IndexEntry {
  id: string;
  title: string;
  created: string;
  turns: SessionTurn[];
  project?: string;
}

export interface RenderIndexOptions {
  index: IndexConfig;
  /** Show a project column: the config names more than one project (§8.4). */
  projectColumn: boolean;
  /** Read back from disk for conversations this run did not regenerate. */
  carried: CarriedTranscript[];
  /** Uuids the config withholds. */
  excluded: string[];
  /**
   * The tool policy the transcripts were written under, so the index describes
   * them truthfully. Absent means the default: `tools: strip`, no `keepTools`.
   */
  policy?: Pick<ContentPolicy, 'tools' | 'keepTools'>;
}

interface Row {
  id: string;
  title: string;
  created: string;
  turns: number;
  project: string;
  url: string;
}

const cell = (s: string) => s.replace(/\|/g, '\\|');
const linkText = (s: string) => cell(s).replace(/([[\]])/g, '\\$1');

/** Greedy word wrap, for prose whose wording depends on configuration. */
function wrap(text: string, width = 78): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    if (line !== '' && line.length + 1 + word.length > width) {
      lines.push(line);
      line = word;
    } else {
      line = line === '' ? word : `${line} ${word}`;
    }
  }
  if (line !== '') lines.push(line);
  return lines;
}

const RULES_START =
  'Each transcript is one branch of its conversation. Where a reply was edited ' +
  'or regenerated, the latest version is shown, and `branches_dropped` in the ' +
  'frontmatter says how many others there were. A turn is one exchange, with ' +
  'consecutive assistant messages joined.';
const RULES_END = 'Turn numbers are stable only while these rules are.';

/**
 * What the transcripts are, in a paragraph that has to match the tool policy
 * they were written under. It once said tool calls were stripped whatever the
 * config, which was false under `keepTools` (the named tools are kept) and
 * under `tools: keep` (everything is, and no document has a final version).
 *
 * The default wording is kept line for line as it was, so upgrading does not
 * rewrite every existing index; the other wordings are wrapped.
 */
function rulesParagraph(policy: RenderIndexOptions['policy']): string[] {
  const keepTools = policy?.keepTools ?? [];
  if (policy?.tools !== 'keep' && keepTools.length === 0) {
    return [
      'Each transcript is one branch of its conversation. Where a reply was edited',
      'or regenerated, the latest version is shown, and `branches_dropped` in the',
      'frontmatter says how many others there were. A turn is one exchange, with',
      'consecutive assistant messages joined. Tool calls are stripped, except for',
      'documents Claude wrote, which appear in their final version, and questions it',
      'asked. Turn numbers are stable only while these rules are.',
    ];
  }
  const tools =
    policy?.tools === 'keep'
      ? 'Every tool call is kept, with its result, as JSON; documents Claude wrote ' +
        'appear as the calls that wrote and edited them, not in a final version.'
      : 'Tool calls are stripped, except for documents Claude wrote, which appear ' +
        'in their final version, questions it asked, and calls to ' +
        `${listOf(keepTools.map((t) => `\`${t}\``))}, which are kept with their ` +
        'results as JSON.';
  return wrap(`${RULES_START} ${tools} ${RULES_END}`);
}

/** `a`, `a and b`, `a, b and c`. */
function listOf(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/**
 * The generated index (specification §8.4). Pure.
 *
 * caitx's own rather than cctx's `renderIndex`, whose prose is about Claude
 * Code sessions. What it shares is `parityStatement`, so the alternation claim
 * is measured the same way in both, and the carried rows, read back from the
 * transcripts themselves so the index never shrinks to whatever the newest
 * export happens to hold.
 */
export function renderIndex(
  entries: IndexEntry[],
  options: RenderIndexOptions,
): string {
  const fromFront = (c: CarriedTranscript, key: string) => {
    const v = c.frontmatter[key];
    return typeof v === 'string' ? v : '';
  };

  const rows: Row[] = [
    ...entries.map((e) => ({
      id: e.id,
      title: e.title,
      created: e.created,
      turns: e.turns.length,
      project: e.project ?? '',
      url: conversationUrl(e.id),
    })),
    ...options.carried.map((c) => ({
      id: c.id,
      title: c.title,
      created: c.created,
      turns: c.turns,
      project: fromFront(c, 'project'),
      url: fromFront(c, 'url') || conversationUrl(c.id),
    })),
  ].sort((a, b) => `${a.created}${a.id}`.localeCompare(`${b.created}${b.id}`));

  const lines: string[] = [
    '# claude.ai conversations',
    '',
    'Conversations exported from claude.ai by `caitx`.',
    'This file is generated; edits to it will be overwritten.',
    '',
  ];

  const preamble = options.index.preamble;
  if (preamble !== null && preamble.trim() !== '') lines.push(preamble.trim(), '');

  lines.push(
    ...rulesParagraph(options.policy),
    '',
    parityStatement(entries, options.carried),
    '',
  );

  if (options.carried.length > 0) {
    const n = options.carried.length;
    lines.push(
      (n === 1
        ? 'One row below was read back from a transcript already in this directory, ' +
          'not regenerated: the export this index was built from does not hold it. '
        : `${n} of the rows below were read back from transcripts already in this ` +
          'directory, not regenerated: the export this index was built from does not ' +
          'hold them, or does not select them. ') +
        'The transcript is the record; the export was only ever the source.',
      '',
    );
  }

  const excluded = options.excluded;
  if (excluded.length > 0 && options.index.listExcluded !== 'none') {
    // Visible, never silent, as in cctx: a reader cannot audit an absence they
    // cannot see.
    const count = `${excluded.length} conversation${excluded.length === 1 ? '' : 's'} withheld by configuration`;
    lines.push(
      options.index.listExcluded === 'ids'
        ? `${count}: ${excluded.map((id) => `\`${id}\``).join(', ')}.`
        : `${count}.`,
      '',
    );
  }

  const header = options.projectColumn
    ? [
        '| Created | Title | Turns | Project | Conversation |',
        '| --- | --- | --- | --- | --- |',
      ]
    : ['| Created | Title | Turns | Conversation |', '| --- | --- | --- | --- |'];
  lines.push(
    ...header,
    ...rows.map((r) => {
      const title = `[${linkText(r.title)}](${r.url})`;
      return options.projectColumn
        ? `| ${r.created} | ${title} | ${r.turns} | ${cell(r.project)} | \`${r.id}\` |`
        : `| ${r.created} | ${title} | ${r.turns} | \`${r.id}\` |`;
    }),
    '',
  );

  return lines.join('\n');
}
