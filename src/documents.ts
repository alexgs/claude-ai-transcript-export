import { basename, extname } from 'node:path';
import { fence } from '@alexgsdev/claude-code-transcript-export';
import type { RawBlock } from './types.js';

/**
 * The document model (specification §7.3).
 *
 * A file `create_file` made, keyed by its path, or an artifact the `artifacts`
 * tool made, keyed by its id. Its operations are replayed in order and the
 * finished text rendered once, where it was last edited or presented,
 * whichever is later, with markers at every earlier operation pointing forward
 * to it.
 *
 * That needs turn numbers, which do not exist until every message is turned
 * into turns. So rendering is two passes. The first, during block rendering,
 * records each operation and leaves a token in its place. The second,
 * `resolveDocuments`, runs once turns are built: it finds which turn holds
 * each token, replays, decides placement, and replaces every token.
 */

/** Private-use characters: they do not occur in conversation text. */
const OPEN = '';
const CLOSE = '';
const TOKEN = /(\d+)/g;

type Operation =
  | { kind: 'set'; text: string; verb: 'created' | 'rewritten' }
  | { kind: 'replace'; oldStr: string; newStr: string };

interface DocumentOp {
  token: number;
  op: Operation;
}

interface Doc {
  key: string;
  /** Shown in the header: the full path, or the artifact's title. */
  label: string;
  /** Shown in markers: the file name, or the artifact's title. */
  short: string;
  /** Fence info string. */
  language: string;
  /** For shell matching; files only. */
  path?: string;
  ops: DocumentOp[];
  /** Tokens of `present_files` calls naming this document, in order. */
  presented: number[];
  /** True once a `bash_tool` call after creation named the path. */
  shellTouched: boolean;
}

/** An edit or a pathless file that has no document to belong to. */
interface Loose {
  token: number;
  /** An edit, as against a pathless `create_file`. */
  edit: boolean;
  render: (turn: number) => string;
}

export interface DocumentStats {
  documents: number;
  replayed: number;
  /** Labels of documents whose replay failed and which fell back (§7.3). */
  fellBack: string[];
  shellTouched: number;
  /** Edits rendered as diffs because no document in the conversation had that path. */
  looseEdits: number;
  /**
   * File edits counted one by one, continuing past a failure as the survey
   * did (spec §3), so `probe` can be checked against it. The model itself
   * stops at a document's first failed edit.
   */
  edits: { applied: number; unmatched: number; ambiguous: number };
}

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** A fence info string from a file extension or an artifact's type. */
export function languageFor(pathOrType: string): string {
  const fromType: Record<string, string> = {
    'text/markdown': 'markdown',
    'text/html': 'html',
    'image/svg+xml': 'svg',
    'application/vnd.ant.react': 'jsx',
    'application/vnd.ant.mermaid': 'mermaid',
  };
  if (pathOrType in fromType) return fromType[pathOrType] as string;
  const ext = extname(pathOrType).slice(1).toLowerCase();
  return ext === 'md' ? 'markdown' : ext;
}

/**
 * A document's text for its fence. One final newline is dropped: nearly every
 * file ends with one, and inside a fence it shows as a blank line before the
 * closing backticks. Only that one; anything else is the file as written.
 */
const body = (text: string) => (text.endsWith('\n') ? text.slice(0, -1) : text);

/** `old` and `new` as a unified-diff-shaped body: every line marked. */
function diffBody(oldStr: string, newStr: string): string {
  const mark = (prefix: string, s: string) =>
    s === '' ? [] : s.split('\n').map((line) => `${prefix} ${line}`);
  return [...mark('-', oldStr), ...mark('+', newStr)].join('\n');
}

/**
 * Collects document operations during block rendering. One per conversation.
 */
export class DocumentCollector {
  private next = 0;
  private readonly docs = new Map<string, Doc>();
  private readonly loose: Loose[] = [];
  /** Tokens left by `present_files`, with the paths they name. */
  private readonly presents = new Map<number, string[]>();

  private token(): number {
    return this.next++;
  }

  private place(token: number): string {
    return `${OPEN}${token}${CLOSE}`;
  }

  /**
   * A document tool call, recorded. Returns the token to put where the call
   * was, or null when the call is not a document operation at all.
   */
  record(block: RawBlock): string | null {
    const name = str(block.name);
    const input = isRecord(block.input) ? block.input : {};

    if (name === 'create_file') {
      const path = str(input.path);
      const text = str(input.file_text) ?? '';
      const token = this.token();
      if (path === undefined) {
        // No path, so nothing can ever edit it: its own document, in place.
        this.loose.push({
          token,
          edit: false,
          render: (turn) =>
            `**(unnamed file)** — created in turn ${turn}.\n\n${fence(body(text), '')}`,
        });
        return this.place(token);
      }
      const key = `file:${path}`;
      const doc = this.docs.get(key);
      if (doc === undefined) {
        this.docs.set(key, {
          key,
          label: `\`${path}\``,
          short: basename(path),
          language: languageFor(path),
          path,
          ops: [{ token, op: { kind: 'set', text, verb: 'created' } }],
          presented: [],
          shellTouched: false,
        });
      } else {
        // create_file over an existing path replaces it whole.
        doc.ops.push({ token, op: { kind: 'set', text, verb: 'rewritten' } });
      }
      return this.place(token);
    }

    if (name === 'str_replace') {
      const path = str(input.path);
      const op: Operation = {
        kind: 'replace',
        oldStr: str(input.old_str) ?? '',
        newStr: str(input.new_str) ?? '',
      };
      const token = this.token();
      const doc = path === undefined ? undefined : this.docs.get(`file:${path}`);
      if (doc !== undefined) {
        doc.ops.push({ token, op });
      } else {
        // An edit to a file this conversation never created: an upload, or
        // one made in the shell. The edit is the only record of the change.
        const label = path === undefined ? 'a file (no path given)' : `\`${path}\``;
        this.loose.push({
          token,
          edit: true,
          render: () =>
            `**${label}** — edited; no earlier version is in this conversation.\n\n` +
            fence(diffBody(op.oldStr, op.newStr), 'diff'),
        });
      }
      return this.place(token);
    }

    if (name === 'artifacts') {
      const id = str(input.id) ?? '(no id)';
      const command = str(input.command);
      const key = `artifact:${id}`;
      const token = this.token();
      const doc = this.docs.get(key);

      if (command === 'create' || command === 'rewrite') {
        const text = str(input.content) ?? '';
        if (doc === undefined) {
          const title = str(input.title) ?? id;
          this.docs.set(key, {
            key,
            label: `${title} (artifact)`,
            short: title,
            language: languageFor(str(input.type) ?? ''),
            ops: [{ token, op: { kind: 'set', text, verb: 'created' } }],
            presented: [],
            shellTouched: false,
          });
        } else {
          doc.ops.push({ token, op: { kind: 'set', text, verb: 'rewritten' } });
        }
        return this.place(token);
      }

      if (command === 'update') {
        const op: Operation = {
          kind: 'replace',
          oldStr: str(input.old_str) ?? '',
          newStr: str(input.new_str) ?? '',
        };
        if (doc !== undefined) {
          doc.ops.push({ token, op });
        } else {
          this.loose.push({
            token,
            edit: true,
            render: () =>
              `**Artifact ${id}** — edited; no earlier version is in this conversation.\n\n` +
              fence(diffBody(op.oldStr, op.newStr), 'diff'),
          });
        }
        return this.place(token);
      }

      return `> [unhandled artifacts command: ${command ?? 'undefined'}]`;
    }

    return null;
  }

  /**
   * A `present_files` call: its marker, followed by a token so a document
   * presented here can render its final version after the marker.
   */
  present(paths: string[], marker: string): string {
    const token = this.token();
    this.presents.set(token, paths);
    for (const path of paths) this.docs.get(`file:${path}`)?.presented.push(token);
    return `${marker}${this.place(token)}`;
  }

  /**
   * A `bash_tool` call. Any created document whose path the call names is
   * marked: a clean replay proves only that the file-tool edits agree with
   * each other, not that the shell left the file alone.
   *
   * A string match, so it can false-alarm; it cannot miss a call that names
   * the path, which is the side to err on. Only documents already created are
   * checked, because a shell command before creation cannot have changed it.
   */
  shell(input: unknown): void {
    const command = JSON.stringify(input ?? '');
    for (const doc of this.docs.values()) {
      if (doc.path !== undefined && command.includes(doc.path)) doc.shellTouched = true;
    }
  }

  /** Whether any token was handed out; if not, resolving is a no-op. */
  get empty(): boolean {
    return this.next === 0;
  }

  /**
   * The second pass. `texts` are the turns' texts in order, tokens and all;
   * returns them with every token replaced, and what happened.
   */
  resolve(texts: string[]): { texts: string[]; stats: DocumentStats } {
    const stats: DocumentStats = {
      documents: this.docs.size,
      replayed: 0,
      fellBack: [],
      shellTouched: 0,
      looseEdits: 0,
      edits: { applied: 0, unmatched: 0, ambiguous: 0 },
    };

    for (const doc of this.docs.values()) {
      if (doc.path === undefined) continue;
      let text = '';
      for (const { op } of doc.ops) {
        if (op.kind === 'set') {
          text = op.text;
          continue;
        }
        const first = op.oldStr === '' ? -1 : text.indexOf(op.oldStr);
        if (first === -1) stats.edits.unmatched += 1;
        else if (text.indexOf(op.oldStr, first + 1) !== -1) stats.edits.ambiguous += 1;
        else {
          stats.edits.applied += 1;
          text =
            text.slice(0, first) + op.newStr + text.slice(first + op.oldStr.length);
        }
      }
    }

    const turnOf = new Map<number, number>();
    texts.forEach((text, index) => {
      for (const m of text.matchAll(TOKEN)) turnOf.set(Number(m[1]), index + 1);
    });
    const turn = (token: number) => turnOf.get(token) ?? 0;

    /** What replaces each token. A present token keeps its marker and may gain documents. */
    const replacement = new Map<number, string>();
    const appendAt = new Map<number, string[]>();

    for (const doc of this.docs.values()) {
      const replay = replayDoc(doc);
      if (doc.shellTouched) stats.shellTouched += 1;

      if (replay === null) {
        stats.fellBack.push(doc.label);
        renderFallback(doc, turn, replacement);
        continue;
      }
      stats.replayed += 1;

      const last = doc.ops[doc.ops.length - 1] as DocumentOp;
      const lastPresent = doc.presented[doc.presented.length - 1];
      // The later of the last operation and the last presentation. Token
      // order is creation order, which is branch order.
      const anchor =
        lastPresent !== undefined && lastPresent > last.token
          ? lastPresent
          : last.token;
      const finalTurn = turn(anchor);

      const created = turn((doc.ops[0] as DocumentOp).token);
      const edits = doc.ops.length - 1;
      const history =
        edits === 0
          ? `created in turn ${created}`
          : `created in turn ${created}, ${edits === 1 ? 'edited once' : `edited ${edits} times`}`;
      const shellNote = doc.shellTouched
        ? ' Also touched by shell commands this transcript does not show; this may not be the final file.'
        : '';
      const block =
        `**${doc.label}** — ${history}, final version.${shellNote}\n\n` +
        fence(body(replay), doc.language);

      for (const { token, op } of doc.ops) {
        if (token === anchor) continue;
        const what = op.kind === 'set' ? op.verb : 'edited';
        const where = turn(token) === finalTurn ? 'below' : `in turn ${finalTurn}`;
        replacement.set(
          token,
          `> [document: ${doc.short} — ${what}; final version ${where}]`,
        );
      }

      if (anchor === last.token) {
        replacement.set(anchor, block);
      } else {
        const list = appendAt.get(anchor) ?? [];
        list.push(block);
        appendAt.set(anchor, list);
      }
    }

    for (const loose of this.loose) {
      replacement.set(loose.token, loose.render(turn(loose.token)));
      if (loose.edit) stats.looseEdits += 1;
    }

    for (const token of this.presents.keys()) {
      const docs = appendAt.get(token);
      replacement.set(token, docs === undefined ? '' : `\n\n${docs.join('\n\n')}`);
    }

    const out = texts.map((text) =>
      text.replace(TOKEN, (_, id: string) => {
        const value = replacement.get(Number(id));
        // Every token handed out has a replacement; one without is a bug in
        // this module, and a stray private-use character in a committed
        // transcript is not an acceptable way to find out.
        if (value === undefined)
          throw new Error(`document token ${id} was never resolved`);
        return value;
      }),
    );
    return { texts: out, stats };
  }
}

/**
 * The finished text, or null when any edit fails to apply.
 *
 * An edit applies only when its `old_str` occurs exactly once: none means the
 * text it was written against is not the text replayed so far, and two means
 * the tool would have refused it. Either fails the whole document, because a
 * half-applied replay presented as the finished document looks right and is
 * not.
 */
export function replayDoc(doc: { ops: DocumentOp[] }): string | null {
  let text = '';
  for (const { op } of doc.ops) {
    if (op.kind === 'set') {
      text = op.text;
      continue;
    }
    if (op.oldStr === '') return null;
    const first = text.indexOf(op.oldStr);
    if (first === -1 || text.indexOf(op.oldStr, first + 1) !== -1) return null;
    text = text.slice(0, first) + op.newStr + text.slice(first + op.oldStr.length);
  }
  return text;
}

/** A document whose replay failed: created text and each edit, in place. */
function renderFallback(
  doc: Doc,
  turn: (token: number) => number,
  replacement: Map<number, string>,
): void {
  const shellNote = doc.shellTouched
    ? ' It was also touched by shell commands this transcript does not show.'
    : '';
  doc.ops.forEach(({ token, op }, i) => {
    if (op.kind === 'set') {
      const lead =
        i === 0
          ? `**${doc.label}** — created in turn ${turn(token)}. Its later edits did not all ` +
            `apply, so it is shown as created, with each edit as a diff.${shellNote}`
          : `**${doc.label}** — ${op.verb}.`;
      replacement.set(token, `${lead}\n\n${fence(body(op.text), doc.language)}`);
    } else {
      replacement.set(
        token,
        `**${doc.label}** — edited.\n\n${fence(diffBody(op.oldStr, op.newStr), 'diff')}`,
      );
    }
  });
}

/** The paths a `present_files` input names. */
export function presentedPaths(input: unknown): string[] {
  if (!isRecord(input) || !Array.isArray(input.filepaths)) return [];
  return input.filepaths.filter((p): p is string => typeof p === 'string');
}
