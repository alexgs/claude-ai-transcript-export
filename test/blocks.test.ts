import { describe, expect, it } from 'vitest';
import { renderMessage, renderQuestions } from '../src/blocks.js';
import { DEFAULT_CONTENT_POLICY, type ContentPolicy } from '../src/types.js';
import { message, text, toolResult, toolUse } from './factories.js';

const keep: ContentPolicy = { tools: 'keep', thinking: 'keep', attachments: 'inline' };
const render = (
  content: Parameters<typeof message>[3],
  extra = {},
  policy = DEFAULT_CONTENT_POLICY,
) => renderMessage(message('m', 'p', 'assistant', content, extra), policy);

describe('renderMessage', () => {
  it('renders text verbatim and skips whitespace-only text', () => {
    expect(render([text('Hello\n\nthere'), text('  ')]).parts).toEqual([
      'Hello\n\nthere',
    ]);
  });

  it('drops thinking unless policy keeps it', () => {
    const block = { type: 'thinking', thinking: 'hmm' };
    expect(render([block]).parts).toEqual([]);
    expect(render([block], {}, keep).parts[0]).toBe('```thinking\nhmm\n```');
  });

  it('strips tool traffic by default, and keeps it as fenced JSON on request', () => {
    const blocks = [
      toolUse('bash_tool', { command: 'ls' }),
      toolResult('bash_tool', [{ type: 'text', text: 'out' }]),
    ];
    expect(render(blocks).parts).toEqual([]);
    const kept = render(blocks, {}, keep).parts;
    expect(kept[0]).toContain('```tool_use:bash_tool');
    expect(kept[1]).toContain('```tool_result:bash_tool');
  });

  it('labels a tool result with an empty name honestly', () => {
    expect(render([toolResult('', [])], {}, keep).parts[0]).toContain(
      'tool_result:unknown',
    );
  });

  it('drops harness context', () => {
    expect(
      render([
        { type: 'token_budget', remaining: 5 },
        { type: 'injected_prompt_block', prompt: 'p' },
      ]).parts,
    ).toEqual([]);
  });

  it('marks images and documents by the file name they share a uuid with', () => {
    const files = [
      { file_uuid: 'f1', file_name: 'shot.png' },
      { file_uuid: 'f2', file_name: 'spec.pdf' },
    ];
    const parts = render(
      [
        { type: 'image', file_uuid: 'f1', source: null },
        { type: 'document', file_uuid: 'f2' },
      ],
      { files },
    ).parts;
    expect(parts).toEqual(['> [image: shot.png]', '> [document: spec.pdf]']);
  });

  it('prefers a document title over its file name', () => {
    const parts = render([{ type: 'document', file_uuid: 'f', title: 'The Spec' }], {
      files: [{ file_uuid: 'f', file_name: 'x.pdf' }],
    }).parts;
    expect(parts).toEqual(['> [document: The Spec]']);
  });

  it('marks a file no block named, once', () => {
    const parts = render([{ type: 'image', file_uuid: 'f1' }], {
      files: [
        { file_uuid: 'f1', file_name: 'shot.png' },
        { file_uuid: 'f3', file_name: 'notes.txt' },
      ],
    }).parts;
    expect(parts).toEqual(['> [image: shot.png]', '> [file: notes.txt]']);
  });

  it('marks attachments with name and size, and inlines their text on request', () => {
    const attachments = [
      {
        file_name: 'notes.md',
        file_size: 12_288,
        file_type: '',
        extracted_content: '# Notes',
      },
    ];
    expect(render([], { attachments }).parts).toEqual([
      '> [attachment: notes.md, 12 KB]',
    ]);
    expect(render([], { attachments }, keep).parts).toEqual([
      '> [attachment: notes.md, 12 KB]',
      '```text\n# Notes\n```',
    ]);
  });

  it('marks a flag without rendering its fields', () => {
    const parts = render([{ type: 'flag', flag: 'x', helpline: 'y' }]).parts;
    expect(parts).toEqual(['> [flagged by claude.ai]']);
  });

  it('marks an unknown block type, never dropping it silently', () => {
    expect(render([{ type: 'hologram' }]).parts).toEqual([
      '> [unhandled block type: hologram]',
    ]);
  });

  it('collects citation URLs in order', () => {
    const cite = (url: string) => ({ details: { type: 'web_search_citation', url } });
    const { sources } = render([
      text('a', { citations: [cite('https://a.example'), cite('https://b.example')] }),
      text('b', { citations: [cite('https://a.example')] }),
    ]);
    expect(sources).toEqual([
      'https://a.example',
      'https://b.example',
      'https://a.example',
    ]);
  });

  it('renders present_files as the names shown', () => {
    const parts = render([
      toolUse('present_files', {
        filepaths: ['/mnt/user-data/outputs/a.md', '/mnt/user-data/outputs/b.css'],
      }),
    ]).parts;
    expect(parts).toEqual(['> [presented: a.md, b.css]']);
  });

  it('renders ask_user_input_v0 questions, not its result', () => {
    const input = {
      questions: [
        { question: 'Which tone?', options: ['Grim', 'Bright'], type: 'single_select' },
      ],
    };
    const parts = render([
      toolUse('ask_user_input_v0', input),
      toolResult('ask_user_input_v0', [{ type: 'text', text: '{}' }]),
    ]).parts;
    expect(parts).toEqual(['**Which tone?**\n\n- Grim\n- Bright']);
  });
});

describe('renderQuestions', () => {
  it('says when several answers are allowed, and collapses newlines', () => {
    const out = renderQuestions({
      questions: [
        { question: 'Pick\nany', options: ['a', 'b\nc'], type: 'multi_select' },
      ],
    });
    expect(out).toBe('**Pick any** *(several allowed)*\n\n- a\n- b c');
  });

  it('is null for input without questions', () => {
    expect(renderQuestions({})).toBeNull();
  });
});
