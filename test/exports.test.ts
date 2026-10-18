import { describe, expect, it } from 'vitest';
import * as library from '../src/index.js';

/**
 * The library's runtime surface, as a list, as in cctx. Adding or removing a
 * name fails this test, so either is done on purpose and with a changeset.
 */
describe('library exports', () => {
  it('match the published surface', () => {
    expect(Object.keys(library).sort()).toMatchInlineSnapshot(`
      [
        "CONFIG_NAMES",
        "DEFAULT_CONFIG",
        "DEFAULT_CONTENT_POLICY",
        "ROOT_PARENT",
        "TreeError",
        "buildTurns",
        "chooseBranch",
        "contentPolicy",
        "findConfig",
        "formatProbe",
        "humanSize",
        "loadConfig",
        "loadConfigFile",
        "mergeConfig",
        "parseConfigFile",
        "parseConversations",
        "parseLinkList",
        "parseManifest",
        "probeConversations",
        "readExport",
        "renderMessage",
        "renderQuestions",
        "select",
      ]
    `);
  });
});
