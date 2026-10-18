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
export { formatProbe, probeConversations, type ProbeReport } from './probe.js';
export { ROOT_PARENT, TreeError, chooseBranch, type Branch } from './tree.js';
export { buildTurns, type BuiltTurns } from './turns.js';
export type { DocumentStats } from './documents.js';
export {
  CONFIG_NAMES,
  DEFAULT_CONFIG,
  contentPolicy,
  findConfig,
  loadConfig,
  loadConfigFile,
  mergeConfig,
  parseConfigFile,
  type Config,
  type ConversationEntry,
  type IndexConfig,
  type ProjectConfig,
  type ResolvedConfig,
} from './config.js';
export { parseLinkList, type LinkList } from './linklist.js';
export {
  select,
  type ProjectCount,
  type SelectInput,
  type Selected,
  type Selection,
} from './select.js';
export {
  humanSize,
  renderMessage,
  renderQuestions,
  type RenderedMessage,
} from './blocks.js';
export { DEFAULT_CONTENT_POLICY } from './types.js';
export type {
  AttachmentPolicy,
  ContentPolicy,
  RawBlock,
  RawConversation,
  RawMessage,
  ThinkingPolicy,
  ToolPolicy,
} from './types.js';
