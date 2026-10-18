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
        "ROOT_PARENT",
        "formatProbe",
        "parseConversations",
        "parseManifest",
        "probeConversations",
        "readExport",
      ]
    `);
  });
});
