---
'@alexgsdev/claude-ai-transcript-export': minor
---

Add `.caitx.yaml` and `caitx list <export>`. A config names projects, each fed by a link list: a pasted file of claude.ai chat URLs or uuids, from which every uuid is collected and project uuids are skipped. It can also name single conversations by uuid or, discouraged, by exact title, and an `exclude` list wins over every selector. A uuid that is neither in the export nor already a transcript fails the run, a conversation in two projects' lists is an error, and every project's resolved count is printed. `list` shows each conversation's status, with `--since`, `--unselected` and `--format list`. `--config <path>` reads exactly the file named.
