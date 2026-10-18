import { describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { UsageError } from '@alexgsdev/claude-code-transcript-export';
import {
  DEFAULT_CONFIG,
  contentPolicy,
  findConfig,
  loadConfig,
  loadConfigFile,
  mergeConfig,
} from '../src/config.js';
import { tempDir } from './helpers.js';

describe('findConfig and loadConfig', () => {
  it('walks up to the nearest .caitx.yaml, whose directory is the root', () => {
    const root = tempDir();
    writeFileSync(join(root, '.caitx.yaml'), 'out: transcripts\n');
    const deep = join(root, 'a', 'b');
    mkdirSync(deep, { recursive: true });
    expect(findConfig(deep)).toBe(join(root, '.caitx.yaml'));
    expect(loadConfig(deep)).toMatchObject({ root, config: { out: 'transcripts' } });
  });

  it('returns null rather than guessing when there is none', () => {
    expect(loadConfig(tempDir())).toBeNull();
  });

  it('reads exactly the file --config names', () => {
    const root = tempDir();
    writeFileSync(join(root, '.caitx.yaml'), 'out: standard\n');
    writeFileSync(join(root, 'other.yaml'), 'out: other\n');
    expect(loadConfigFile(join(root, 'other.yaml')).config.out).toBe('other');
  });
});

describe('mergeConfig', () => {
  it('reads keepTools, without duplicates, into the content policy', () => {
    const config = mergeConfig({
      keepTools: ['conversation_search', 'web_search', 'web_search'],
    });
    expect(config.keepTools).toEqual(['conversation_search', 'web_search']);
    expect(contentPolicy(config).keepTools).toEqual([
      'conversation_search',
      'web_search',
    ]);
  });

  it('fills in defaults', () => {
    expect(mergeConfig(null)).toEqual(DEFAULT_CONFIG);
  });

  it('reads projects and conversations, lowercasing uuids', () => {
    const config = mergeConfig({
      projects: [
        {
          name: 'P',
          uuid: '0190ABCD-0000-7000-8000-000000000001',
          list: 'p.txt',
          note: 'n',
        },
      ],
      conversations: [{ uuid: 'ABCDEF01-0000-4000-8000-000000000001' }, { title: 'T' }],
      exclude: ['ABCDEF02-0000-4000-8000-000000000001'],
    });
    expect(config.projects).toEqual([
      {
        name: 'P',
        uuid: '0190abcd-0000-7000-8000-000000000001',
        list: 'p.txt',
        note: 'n',
      },
    ]);
    expect(config.conversations).toEqual([
      { uuid: 'abcdef01-0000-4000-8000-000000000001' },
      { title: 'T' },
    ]);
    expect(config.exclude).toEqual(['abcdef02-0000-4000-8000-000000000001']);
  });

  it.each([
    [{ exlcude: [] }, /unknown config key `exlcude`/],
    [{ projects: [{ name: 'P' }] }, /needs a `list`/],
    [{ projects: [{ list: 'x' }] }, /needs a `name`/],
    [
      {
        projects: [
          { name: 'P', list: 'a' },
          { name: 'P', list: 'b' },
        ],
      },
      /two projects are named/,
    ],
    [{ projects: [{ name: 'P', list: 'a', colour: 'red' }] }, /projects\[0\]\.colour/],
    [{ conversations: [{ note: 'n' }] }, /exactly one of `uuid` and `title`/],
    [{ conversations: [{ uuid: 'u', title: 't' }] }, /exactly one/],
    [{ tools: 'some' }, /`tools` must be one of strip \| keep/],
    [{ attachments: 'all' }, /`attachments`/],
    [{ index: { wat: 1 } }, /index\.wat/],
    [{ keepTools: 'conversation_search' }, /list of tool names/],
    [{ keepTools: ['create_file'] }, /already preserved in readable form/],
    [{ keepTools: ['ask_user_input_v0', 'present_files'] }, /are already preserved/],
  ])('rejects %j', (raw, message) => {
    expect(() => mergeConfig(raw)).toThrow(UsageError);
    expect(() => mergeConfig(raw)).toThrow(message);
  });
});
