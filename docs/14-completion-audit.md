# 14. Completion audit

## Authorization and target

On 2026-07-26 Panda authorized real Claude Code and Agent SDK integration and
requested completion through the full Definition of Done. This removes the
earlier research hold; it does not relax deterministic lifecycle, durability,
security, bounded-context, or acceptance requirements.

## Current audit — 2026-07-31

This table reflects source, migrations, public CLI/protocol surfaces, tests, and
the commit sequence through `b93f75e`; it is not the original authorization
baseline.

| Area | Current state | Remaining gate |
|---|---|---|
| Phase 0 | partial | recorded real hook/latency evidence, TUI cancel, mouse/clipboard, forced-crash cleanup, completed 24-hour result, packaging acceptance |
| Phase 1 | complete | log rotation, richer doctor, and backup/restore intentionally remain in hardening |
| Phase 2 | complete | no phase gate; later UI/runtime behavior is recorded in D-028–D-034 |
| Phase 3 | vertical slice | real hook fixtures/config, safe urgent interruption, fake FirstMate consuming the public kit end to end, direct spool-replayer failure tests |
| Phase 4 | partial | topic memory, reconcile/import, recovery journal/classification/report, operational backup CLI/policy and restore |
| Phase 5 | partial read-only slice | validated tools, durable conversation/session projection, explicit routing/memory workflow, TUI cancellation, context/cost telemetry |
| Phase 6 | partial live TUI | Conversation/Memory/Sessions/Diagnostics, command palette, subscriptions, full accessibility/terminal/visual acceptance |
| Phase 7 | partial shared profiles | formal adapters, capability and recovery policy per profile, real Arc/Git/Docs end-to-end acceptance |
| Phase 8 | partial personal operations | launch-at-login, support bundle, retention, backup/restore, failure injection, upgrade/rollback, profiling, seven-day dogfood |

## Implemented evidence

- SQLite schema migration version 8 covers projects and custom display names,
  append-only events/idempotency results, mailbox/status/checkpoints, one-shot
  timers, hook receipts, and decision supersession.
- Storage has an unexposed `VACUUM INTO` backup primitive with SHA-256 output;
  no operational command, scheduling, pre-migration backup, restore, or drill
  exists.
- The daemon is the single operational writer and runs supervision, mailbox
  retry, timer firing, hook-spool replay, and deterministic memory
  materialization.
- `packages/runtime-tmux` owns discovery, argument boundaries, stable IDs,
  Watcher deployment, Home tabs, graceful/reset actions, and fleet shutdown.
- The live launcher polls daemon projections every 500 ms, overlays bounded
  tmux/workspace evidence, drives OpenTUI over validated process IPC, and uses a
  tool-free bounded Agent SDK brain for free-form input.
- Onboarding launches the three public profiles, stopped projects can be
  restarted by slug and reopened as tabs, crew sessions render as project
  children, and a durable custom Fleet label can be set or cleared.
- A deployable personal macOS launcher, diagnostic logs, source reload, and
  graceful whole-system shutdown exist.
- `pnpm check` passes. `TMPDIR=/tmp pnpm test` passes 135 tests; the short
  temporary root avoids a known test-fixture collision with the production
  Unix socket path limit.

## Actual execution order from here

1. Close the Phase 3 integration gate without giving the model lifecycle power.
2. Add Phase 4 recovery journal/classification/reporting and backup/restore.
3. Expand memory from the single generated index to reviewed topic material and
   reconciliation.
4. Add narrow validated brain tools and durable conversation/session state.
5. Promote the current spike-hosted TUI into its production shape and finish
   missing views/subscription/accessibility evidence.
6. Formalize real adapters and execute one real project journey per profile.
7. Complete hardening and the full acceptance matrix, recording inherently
   time-dependent evidence such as seven-day dogfood honestly.

## Documentation rule

Roadmap/specification sections may describe target behavior, but must label it
as target when code does not implement it. README and this audit are the current
handoff; phase progress documents are evidence logs, not permission to infer
that a later phase is complete.
