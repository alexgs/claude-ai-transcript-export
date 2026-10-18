/**
 * caitx — extract claude.ai conversations into markdown transcripts.
 *
 * Library entry point. See `docs/specs/02-specification.md` §12.
 *
 * Nothing below the CLI layer reads the clock, the environment or the home
 * directory; where a function needs one, it takes it as a parameter. Exports
 * grow only when a consumer needs more (§12).
 */

export {
  parseConversations,
  parseManifest,
  readExport,
  type ExportInput,
} from './input.js';
export {
  ROOT_PARENT,
  formatProbe,
  probeConversations,
  type ProbeReport,
} from './probe.js';
export type { RawBlock, RawConversation, RawMessage } from './types.js';
