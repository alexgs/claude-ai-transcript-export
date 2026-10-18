import { describe, expect, it } from 'vitest';
import { parseLinkList } from '../src/linklist.js';

const A = 'aaaaaaaa-0000-4000-8000-000000000001';
const B = 'bbbbbbbb-0000-4000-8000-000000000002';
const P = '0190f1c5-0000-7000-8000-000000000001';

describe('parseLinkList', () => {
  it('collects uuids from chat URLs, bare lines and prose, in order', () => {
    const text = [
      `https://claude.ai/chat/${A}`,
      `  ${B.toUpperCase()}  `,
      `Here is another one you asked about: ${'cccccccc-0000-4000-8000-000000000003'}.`,
    ].join('\n');
    expect(parseLinkList(text).uuids).toEqual([
      A,
      B,
      'cccccccc-0000-4000-8000-000000000003',
    ]);
  });

  it('skips comment lines and collapses duplicates', () => {
    const text = `# ${B} is commented out\n${A}\nhttps://claude.ai/chat/${A}\n`;
    expect(parseLinkList(text).uuids).toEqual([A]);
  });

  it('skips and reports a project uuid', () => {
    const list = parseLinkList(`https://claude.ai/project/${P}\n${A}`, new Set([P]));
    expect(list.uuids).toEqual([A]);
    expect(list.skippedProjectUuids).toEqual([P]);
  });

  it('handles CRLF line endings', () => {
    expect(parseLinkList(`${A}\r\n# ${B}\r\n`).uuids).toEqual([A]);
  });
});
