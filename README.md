# Claude.ai Transcript Export (caitx)

Extract selected conversations from a claude.ai account export into readable,
committable markdown transcripts.

**Status: in development.** Nothing is implemented yet beyond the command
skeleton. The design is in [the brief](docs/specs/01-brief.md) and
[the specification](docs/specs/02-specification.md), and the order of work is
in [the implementation plan](docs/plans/01-implementation-plan.md).

`caitx` is the sibling of
[`cctx`](https://github.com/alexgs/claude-code-transcript-export), which does
the same for Claude Code's local session logs, and it is built on that
package's library. The two write transcripts in the same format.

## License

MIT
