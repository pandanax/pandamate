# 14. Completion audit

## Authorization and target

On 2026-07-26 Panda authorized real Claude Code and Agent SDK integration and
requested completion through the full Definition of Done. This removes the
earlier research hold; it does not relax deterministic lifecycle, durability,
security, bounded-context, or acceptance requirements.

## Baseline at authorization

| Area | State | Remaining gate |
|---|---|---|
| Phase 0 | partial | Agent SDK stream/cancel/hook measurements and final TUI acceptance |
| Phase 1 | complete | backup/restore is intentionally in hardening |
| Phase 2 | in progress | fixture, heartbeat, reconciliation, daemon-backed lifecycle/TUI |
| Phase 3 | absent | hooks, mailbox, timers, FirstMate kit |
| Phase 4 | absent | decisions, Markdown memory, checkpoints, recovery, backup |
| Phase 5 | absent | Agent SDK brain, tools, routing, streaming, rotation |
| Phase 6 | prototype only | production daemon-backed TUI and complete views |
| Phase 7 | absent | Arc, Git, Docs adapters and onboarding |
| Phase 8 | absent | launch service, support bundle, retention, failure/upgrade tooling |

The repository contained about five thousand lines across 55 source and
specification files. The immediate dependency gate is Phase 2: no model-backed
feature may own or infer process lifecycle.

## Execution order

1. Finish deterministic tmux supervision with an isolated fake FirstMate.
2. Add durable hook, mailbox, status, checkpoint, and timer protocols.
3. Add memory materialization and startup recovery.
4. Integrate Claude behind the FirstMate and brain adapter boundaries.
5. ~~Replace the TUI snapshot launcher with daemon projections/subscriptions.~~
   Completed with 500 ms daemon projection polling, cursor-based event replay,
   validated IPC updates, and an already-open Fleet smoke test.
6. Add real project adapters, operational hardening, and scripted acceptance.
7. Run the complete acceptance matrix and record any intrinsically
   time-dependent evidence (notably seven-day dogfood) honestly.
