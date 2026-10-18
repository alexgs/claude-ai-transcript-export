export const TEMPLATE = `# caitx configuration. This file's location marks the project root.

# Where transcripts are written, relative to this file.
out: docs/conversations

# Whole claude.ai projects. Each points at a link list: a text file holding the
# project's conversations as claude.ai chat URLs or bare uuids, one per line.
# Paste it from the project page, or ask Claude inside the project to list its
# conversations and paste the reply. Every uuid in the list must exist, or the
# run fails. Compare the count each run prints with the project page once:
# nothing in an export can tell a list is missing conversations.
projects: []
#  - name: My project              # recorded in each transcript; required
#    uuid: 0190...                 # the project's uuid, from its URL; optional
#    list: conversations/my-project.txt
#    note: Why this project is here.

# Single conversations, in or out of any project. Prefer uuid: titles change.
conversations: []
#  - uuid: 61b697dd-...
#    note: Why this conversation is here.

# Conversation uuids never written. Wins over everything above, and deletes a
# transcript already written. Taking a uuid out of a link list does not.
exclude: []

# Content policy.
tools: strip          # strip | keep
thinking: drop        # drop | keep
attachments: marker   # marker | inline
skipEmpty: true

index:
  enabled: true
  preamble: null      # project-specific prose, inserted verbatim
  listExcluded: count # count | ids | none
`;
