# 13. Phase 2 progress

## Runtime tmux foundation

The first Phase 2 increment promotes reusable process-boundary code from the
tmux spike into `packages/runtime-tmux`:

- stable `firstmate-<project-slug>` target generation;
- stable session, pane, client-TTY, and private socket validation;
- tmux execution through explicit argument arrays;
- injectable command execution for deterministic unit tests;
- isolated `tmux -L` server support;
- session/client resolution and bounded discovery formats;
- lifecycle helpers used by the real smoke tests;
- registered-project opening as a linked `pandamate:home` tab, with safe unlink
  on close/stop/restart/recovery. The older separate-iTerm-window adapter remains
  an argument-array fallback for unregistered discovered sessions and resolves
  an absolute tmux executable because iTerm does not search `$PATH` there.
- confirmed graceful shutdown delivery to the active pane of window `0` in an
  adopted FirstMate session, with immediate whole-session kill kept separate.
- confirmed Reset delivery to that same main pane, instructing the FirstMate to
  gracefully stop its crew and then redeploy Watcher and service windows
  without closing its primary session.

The spike retains only demonstration-specific projection and orchestration.
There is no direct tmux implementation duplicated inside it.

## Evidence

Unit tests verify:

- unsafe target and socket values are rejected;
- workspace paths containing spaces remain one command argument;
- discovery aggregates sessions and panes deterministically;
- malformed or cross-session discovery evidence is rejected;
- Home tabs and iTerm fallback can only attach to resolved stable tmux session
  IDs; closing a linked tab unlinks rather than killing the shared window.
- graceful shutdown resolves a stable pane target, sends bounded literal text,
  and sends Enter as a separate argument-array tmux operation.
- graceful action results retain the Fleet item as inactive instead of deleting
  its project identity; Reset uses the same safe delivery boundary.

The repository TypeScript check and complete test suite pass after the package
move. Real tmux smoke commands remain available and use private servers; they do
not touch user sessions.

## Durable session adoption

`pandamate project adopt <project> <tmux-session>` is now a daemon-backed,
idempotent mutation. The daemon discovers the named session, rejects
`pandamate:*` control surfaces and sessions without live panes, resolves its
stable `$session_id`, and commits the association with the audit event
`project.tmux.adopted`.

Adoption also records `desired_state=running` and evidence-backed
`actual_state=running`. A project cannot be silently rebound to another target,
and one stable target cannot be assigned to two projects. The SQLite uniqueness
constraint and event are committed in the same transaction.

The CLI integration test creates the candidate on an isolated `tmux -L` server,
adopts it, restarts the daemon without restarting the candidate, and verifies
identical project and event projections afterward.

## Supervision and live control

Phase 2 is complete:

- `fixtures/fake-firstmate` emits atomic, validated heartbeat documents and
  accepts deterministic pause, resume, crash, and exit controls;
- the daemon reconciles every durable project against observed tmux evidence;
- desired-running projects are started, missing or stale fixture runtimes are
  recovered, and desired-stopped projects remain visible but inactive;
- `start`, `open`, `stop`, and `restart` are daemon-backed commands;
- a hard `x` first persists `desired_state=stopped` before killing the runtime,
  preventing accidental resurrection;
- `g` and `r` remain bounded messages to the main FirstMate in window zero:
  graceful crew shutdown keeps that FirstMate available, while reset asks it
  to shut down and redeploy its own service windows;
- the discovered TUI polls daemon project projections and replays new events
  from its last sequence cursor. A temporary daemon disconnect does not discard
  the last good projection.

The integration demonstration starts two fixtures on an isolated tmux server,
observes their heartbeats, kills one unexpectedly, verifies automatic recovery
under a new stable tmux target, requests a restart, stops the other project,
and restarts the daemon. The running project returns and the stopped project
stays stopped.

## Subsequent progress

Phase 3 has since added the durable mailbox, hook ingestion/spool and daemon
replayer, bounded FirstMate status/checkpoints, persisted one-shot timers, and
the public FirstMate kit. General Pandamate input now has a bounded read-only
brain slice; mutation tools remain gated on the unfinished Phase 3/4 recovery
boundaries.

## Folder-first project onboarding

Pandamate now exposes the primary creation journey in both CLI and TUI:

```bash
pnpm pandamate project create FirstMateGit /absolute/workspace
```

The `i` key opens a writing surface with paste/drag support. Its deterministic
creation parser accepts `FirstMateArc`, `FirstMateGit`, and `DocResearch`,
derives a bounded slug and title from the folder, registers the project, and
requests `desired_state=running`. The supervisor injects the selected public
profile, workspace, tmux session, Claude executable, and FirstMate identity into
the launch prompt.

The repository skill `.claude/skills/create-project/SKILL.md` carries the same
workflow for the Pandamate brain. It is intentionally concise and validated as
a standalone skill.
