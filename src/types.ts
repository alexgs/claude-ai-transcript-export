/**
 * Types for the claude.ai account export.
 *
 * Every field is optional. The format is undocumented, observed in one export
 * (brief §3), and has already moved once: a sharded directory replaced a
 * single zip. Nothing here is a promise about what a record contains.
 */

/** One content block inside a message. */
export interface RawBlock {
  type?: string;
  text?: string;
  name?: string;
  input?: unknown;
  content?: unknown;
  citations?: unknown;
  [key: string]: unknown;
}

/** One message. A conversation's messages form a tree (specification §6.1). */
export interface RawMessage {
  uuid?: string;
  parent_message_uuid?: string;
  sender?: string;
  text?: string;
  content?: RawBlock[];
  attachments?: unknown[];
  files?: unknown[];
  created_at?: string;
  updated_at?: string;
  [key: string]: unknown;
}

export interface RawConversation {
  uuid?: string;
  name?: string;
  summary?: string;
  created_at?: string;
  updated_at?: string;
  chat_messages?: RawMessage[];
  [key: string]: unknown;
}
