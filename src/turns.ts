import type { SessionTurn, Speaker } from '@alexgsdev/claude-code-transcript-export';
import { renderMessage } from './blocks.js';
import type { ContentPolicy, RawMessage } from './types.js';
import { DEFAULT_CONTENT_POLICY } from './types.js';

export interface BuiltTurns {
  turns: SessionTurn[];
  /** Human messages with nothing visible after policy: not turns (§6.2). */
  emptyHumanMessages: number;
  /** Messages rendered from `text` because `content` was empty (§6.3). */
  textFallbacks: number;
}

const SPEAKERS: Record<string, Speaker> = { human: 'Human', assistant: 'Assistant' };

/** Deduplicated in first-cited order, listed after the prose (§7.5). */
function sourceList(urls: string[]): string | null {
  const unique = [...new Set(urls)];
  return unique.length > 0
    ? ['Sources:', ...unique.map((u) => `- ${u}`)].join('\n')
    : null;
}

/**
 * A branch's messages as turns (specification §6.2).
 *
 * - A human message is a turn when something in it is visible after policy.
 * - Consecutive assistant messages coalesce into one turn, as cctx coalesces
 *   assistant records. "Consecutive" is among turns: a human message that is
 *   not a turn does not separate two assistant messages. 14 of the 15
 *   same-sender pairs on the observed export's chosen branches are two
 *   assistant messages in a row.
 * - An assistant turn with nothing visible is dropped. Two human turns left
 *   adjacent stay two turns, and the index counts the break.
 */
export function buildTurns(
  messages: RawMessage[],
  policy: ContentPolicy = DEFAULT_CONTENT_POLICY,
): BuiltTurns {
  const pending: Array<{ speaker: Speaker; parts: string[]; sources: string[] }> = [];
  let emptyHumanMessages = 0;
  let textFallbacks = 0;

  for (const message of messages) {
    const speaker = SPEAKERS[message.sender ?? ''];
    if (speaker === undefined) {
      throw new Error(
        `message ${message.uuid ?? '(no uuid)'} has sender ${JSON.stringify(message.sender)}; ` +
          'only human and assistant are known. Run `caitx probe` on this export.',
      );
    }

    let { parts, sources } = renderMessage(message, policy);
    const contentEmpty =
      !Array.isArray(message.content) || message.content.length === 0;
    if (
      contentEmpty &&
      typeof message.text === 'string' &&
      message.text.trim() !== ''
    ) {
      // §6.3: never seen in the observed export, so counted where it happens.
      parts = [message.text, ...parts];
      textFallbacks += 1;
    }

    if (speaker === 'Human' && parts.length === 0) {
      emptyHumanMessages += 1;
      continue;
    }

    const last = pending[pending.length - 1];
    if (speaker === 'Assistant' && last?.speaker === 'Assistant') {
      last.parts.push(...parts);
      last.sources.push(...sources);
    } else {
      pending.push({ speaker, parts: [...parts], sources: [...sources] });
    }
  }

  const turns = pending
    .map(({ speaker, parts, sources }) => {
      const list = sourceList(sources);
      return { speaker, text: [...parts, ...(list ? [list] : [])].join('\n\n').trim() };
    })
    .filter((turn) => turn.text !== '');

  return { turns, emptyHumanMessages, textFallbacks };
}
