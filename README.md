# Claude.ai Transcript Export (caitx)

Extract selected conversations from a claude.ai account export into readable,
committable markdown transcripts.

**Status: in development.** One command works so far:

```sh
caitx probe ~/downloads/claude-archive-2026-10-18
```

It reports the export's schema (counts of conversations, messages, block types
and tool names, forks, and anything this tool does not handle) and writes
nothing. It never prints a value from a conversation, so its output is safe to
paste into an issue. Run it on every new export before trusting the rest. The design is in [the brief](docs/specs/01-brief.md) and
[the specification](docs/specs/02-specification.md), and the order of work is
in [the implementation plan](docs/plans/01-implementation-plan.md).

`caitx` is the sibling of
[`cctx`](https://github.com/alexgs/claude-code-transcript-export), which does
the same for Claude Code's local session logs, and it is built on that
package's library. The two write transcripts in the same format.

## License

MIT
