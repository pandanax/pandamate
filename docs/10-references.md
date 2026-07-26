# 10. Research references

These sources informed the specification. They are not runtime dependencies;
versions and behavior must be rechecked during Phase 0 and before upgrades.

## Claude Code and Agent SDK

- [Claude Code hooks reference](https://code.claude.com/docs/en/hooks) — hook
  lifecycle, payload fields, command/HTTP handlers, blocking behavior, and
  session/task events.
- [Agent SDK hooks](https://code.claude.com/docs/en/agent-sdk/hooks) — typed SDK
  callbacks, cancellation, and hook results.
- [Agent SDK TypeScript reference](https://code.claude.com/docs/en/agent-sdk/typescript)
  — SDK types, sessions, tools, hooks, and packaging constraints.
- [Work with Agent SDK sessions](https://code.claude.com/docs/en/agent-sdk/sessions)
  — continue, resume, fork, persistence, and session identity.
- [Claude Code memory](https://code.claude.com/docs/en/memory) — `CLAUDE.md`,
  auto-memory, bounded `MEMORY.md`, and on-demand topic files.
- [Claude Code context window](https://code.claude.com/docs/en/context-window) —
  compaction behavior, context costs, and isolation.
- [Claude Code agent teams](https://code.claude.com/docs/en/agent-teams) —
  independent sessions, mailbox, shared tasks, tmux display, and current
  experimental constraints.
- [Long-running Claude for scientific computing](https://www.anthropic.com/research/long-running-Claude)
  — persistent memory, test oracles, and orchestration patterns for multi-day
  workflows.

## Terminal UI

- [OpenTUI repository](https://github.com/anomalyco/opentui) — Zig renderer,
  TypeScript bindings, component APIs, and production use by OpenCode.
- [Ratatui](https://ratatui.rs/) — fallback rich TUI framework with a mature
  Rust/crossterm ecosystem.

## Decisions derived from research

- Hooks are suitable for low-context telemetry because they execute outside the
  model context unless they explicitly return additional context.
- Native Claude agent teams validate the mailbox/tmux model but are not used as
  Pandamate’s durable top-level registry.
- Resuming one session forever is not the persistence strategy; durable memory
  plus bounded episodes is.
- The TUI technology remains a measured Phase 0 decision because renderer
  reliability and packaging matter more than feature lists.

