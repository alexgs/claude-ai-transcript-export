import { basename } from 'node:path';
import { fence } from '@alexgsdev/claude-code-transcript-export';
import { DocumentCollector, presentedPaths } from './documents.js';
import type { ContentPolicy, RawBlock, RawMessage } from './types.js';
import { DEFAULT_CONTENT_POLICY } from './types.js';

/** One message rendered: its markdown parts and the sources it cited. */
export interface RenderedMessage {
  parts: string[];
  /** Citation URLs, in first-cited order, not yet deduplicated across a turn. */
  sources: string[];
}

/** Bytes as a human-readable size, for attachment markers. */
export function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

/** `files[]` as a map from `file_uuid` to `file_name`. */
function fileNames(message: RawMessage): Map<string, string> {
  const names = new Map<string, string>();
  for (const file of Array.isArray(message.files) ? message.files : []) {
    if (!isRecord(file)) continue;
    const uuid = str(file.file_uuid);
    if (uuid !== undefined) names.set(uuid, str(file.file_name) ?? '(unnamed)');
  }
  return names;
}

/**
 * The questions an `ask_user_input_v0` call put to the author.
 *
 * The answer survives without help, as the next human message (spec §3).
 * The questions do not: the `tool_result` only echoes them as JSON, and the
 * `tool_use` is stripped with every other call. An answer like "the second
 * one" is unreadable without them, which is the same argument cctx spec 02
 * makes for its answered widgets.
 */
export function renderQuestions(input: unknown): string | null {
  if (!isRecord(input) || !Array.isArray(input.questions)) return null;

  const parts: string[] = [];
  for (const q of input.questions) {
    if (!isRecord(q)) continue;
    const question = str(q.question)?.replace(/\s+/g, ' ').trim();
    if (!question) continue;
    // Newlines collapse, as in cctx: a newline inside `**…**` breaks the
    // emphasis in half.
    const several = q.type === 'multi_select' ? ' *(several allowed)*' : '';
    const options = (Array.isArray(q.options) ? q.options : [])
      .map((o) => (typeof o === 'string' ? o : isRecord(o) ? str(o.label) : undefined))
      .filter((o): o is string => o !== undefined && o.trim() !== '')
      .map((o) => `- ${o.replace(/\s+/g, ' ').trim()}`);
    parts.push(
      [`**${question}**${several}`, ...(options.length ? ['', ...options] : [])].join(
        '\n',
      ),
    );
  }
  return parts.length > 0 ? parts.join('\n\n') : null;
}

/** `present_files`: which files the author was shown (cctx spec 04's counterpart). */
export function renderPresented(input: unknown): string | null {
  if (!isRecord(input) || !Array.isArray(input.filepaths)) return null;
  const names = input.filepaths
    .filter((p): p is string => typeof p === 'string')
    .map((p) => basename(p));
  return names.length > 0 ? `> [presented: ${names.join(', ')}]` : null;
}

/** Tools whose content is a document, rendered through the model in §7.3. */
export const DOCUMENT_TOOLS = new Set(['create_file', 'str_replace', 'artifacts']);

/**
 * Tools already preserved under `tools: strip`, each in its own readable
 * form. `keepTools` cannot name them: they would render twice, once readably
 * and once as JSON.
 */
export const PRESERVED_TOOLS = new Set([
  ...DOCUMENT_TOOLS,
  'ask_user_input_v0',
  'present_files',
]);

/**
 * The name of the call a `tool_result` answers, found by `tool_use_id` in the
 * same message. Every one of the 8,889 results in the observed export sits in
 * its call's message, and 19 of them carry an empty `name` of their own, so
 * the call is the reliable source (spec §3).
 */
function callName(block: RawBlock, message: RawMessage): string | undefined {
  const id = str(block.tool_use_id);
  if (id === undefined) return undefined;
  const call = (Array.isArray(message.content) ? message.content : []).find(
    (b) => b?.type === 'tool_use' && b.id === id,
  );
  return call === undefined ? undefined : str(call.name);
}

/**
 * One block as markdown, or null when policy drops it (specification §7.1).
 *
 * `sources` collects the block's citation URLs for the turn's source list.
 * `documents` records document operations for the second pass; without one,
 * document tools render nothing, which is what stripping would do.
 */
export function renderBlock(
  block: RawBlock,
  message: RawMessage,
  policy: ContentPolicy,
  sources: string[],
  documents?: DocumentCollector,
): string | null {
  switch (block.type) {
    case 'text': {
      for (const citation of Array.isArray(block.citations) ? block.citations : []) {
        const url =
          isRecord(citation) && isRecord(citation.details)
            ? str(citation.details.url)
            : undefined;
        if (url !== undefined && url !== '') sources.push(url);
      }
      const text = str(block.text) ?? '';
      return text.trim() === '' ? null : text;
    }

    case 'thinking':
      return policy.thinking === 'keep'
        ? fence(str(block.thinking) ?? '', 'thinking')
        : null;

    case 'tool_use': {
      const name = str(block.name) ?? 'unknown';
      const json = () =>
        fence(JSON.stringify(block.input ?? null, null, 2), `tool_use:${name}`);
      if (policy.tools === 'keep') return json();
      if (policy.keepTools?.includes(name)) {
        // A kept shell command still counts against documents it names.
        if (name === 'bash_tool') documents?.shell(block.input);
        return json();
      }
      if (name === 'ask_user_input_v0') return renderQuestions(block.input);
      if (name === 'present_files') {
        const marker = renderPresented(block.input);
        if (marker === null || documents === undefined) return marker;
        return documents.present(presentedPaths(block.input), marker);
      }
      if (documents !== undefined) {
        if (DOCUMENT_TOOLS.has(name)) return documents.record(block);
        if (name === 'bash_tool') documents.shell(block.input);
      }
      return null;
    }

    case 'tool_result': {
      const name = callName(block, message) ?? (str(block.name) || 'unknown');
      const kept = policy.tools === 'keep' || policy.keepTools?.includes(name) === true;
      if (!kept) return null;
      return fence(
        JSON.stringify(block.content ?? null, null, 2),
        `tool_result:${name}`,
      );
    }

    case 'token_budget':
    case 'injected_prompt_block':
      // Harness context, not authored: the counterpart of cctx's
      // system-reminder.
      return null;

    case 'image':
    case 'document': {
      const names = fileNames(message);
      const uuid = str(block.file_uuid);
      const name =
        (block.type === 'document' ? str(block.title) : undefined) ??
        (uuid !== undefined ? names.get(uuid) : undefined) ??
        '(unnamed)';
      return `> [${block.type}: ${name}]`;
    }

    case 'flag':
      return '> [flagged by claude.ai]';

    default:
      return `> [unhandled block type: ${block.type ?? 'undefined'}]`;
  }
}

/**
 * Every block of a message, then its attachments, then any file no block
 * already named (specification §7.1).
 */
export function renderMessage(
  message: RawMessage,
  policy: ContentPolicy = DEFAULT_CONTENT_POLICY,
  documents?: DocumentCollector,
): RenderedMessage {
  const sources: string[] = [];
  const parts: string[] = [];
  const blocks = Array.isArray(message.content) ? message.content : [];

  for (const block of blocks) {
    const part = renderBlock(block ?? {}, message, policy, sources, documents);
    if (part !== null) parts.push(part);
  }

  for (const attachment of Array.isArray(message.attachments)
    ? message.attachments
    : []) {
    if (!isRecord(attachment)) continue;
    const name = str(attachment.file_name) || '(unnamed)';
    const size =
      typeof attachment.file_size === 'number'
        ? `, ${humanSize(attachment.file_size)}`
        : '';
    parts.push(`> [attachment: ${name}${size}]`);
    const extracted = str(attachment.extracted_content);
    if (
      policy.attachments === 'inline' &&
      extracted !== undefined &&
      extracted !== ''
    ) {
      parts.push(fence(extracted, 'text'));
    }
  }

  const named = new Set(
    blocks
      .filter((b) => b?.type === 'image' || b?.type === 'document')
      .map((b) => str(b.file_uuid))
      .filter((u): u is string => u !== undefined),
  );
  for (const [uuid, name] of fileNames(message)) {
    if (!named.has(uuid)) parts.push(`> [file: ${name}]`);
  }

  return { parts, sources };
}
