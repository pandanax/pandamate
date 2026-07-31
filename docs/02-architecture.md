# 02. Architecture

## 1. System shape

```text
┌─────────────────────── pandamate TUI ───────────────────────┐
│ views · command palette · chat · tmux navigation            │
└────────────────────────────┬─────────────────────────────────┘
                             │ local Unix socket
┌────────────────────────────▼─────────────────────────────────┐
│ pandamated                                                    │
│ registry · event log · message bus · timers · reconciliation │
└───────┬───────────────┬───────────────┬──────────────┬───────┘
        │               │               │              │
     SQLite          memory/          tmux         Claude Agent SDK*
        │                               │              │
        └──────── hooks/CLI ───── FirstMate sessions ──┘
```

`*` The SDK currently runs in the TUI launcher; moving brain episode ownership
behind the daemon boundary is target architecture.

The daemon is the only writer to operational state. TUI instances, hook clients,
and CLI commands submit typed commands to it.

Implementation status (2026-07-31): the deterministic daemon, SQLite, IPC,
tmux supervisor, mailbox/timers/hooks, decision materializer, and daemon-backed
TUI projections are live. The Claude brain currently runs in the TUI launcher
process, not in the daemon, and has no mutation tools. Boxes and responsibilities
below that are not yet live are called out explicitly.

## 2. Components

### 2.1 `pandamated`

A long-running deterministic process responsible for:

- owning the SQLite connection and migrations;
- serializing state transitions;
- serving the local IPC protocol;
- supervising tmux sessions and child launchers;
- scheduling health checks, retries, and maintenance;
- appending events and producing current projections;
- eventually invoking/owning the Claude brain only for semantic operations
  (the current brain is hosted by the TUI launcher);
- materializing human-readable memory.

The daemon must remain useful when Claude authentication or the network is down.

### 2.2 `pandamate`

The current deterministic CLI has subcommands; the Desktop launcher/
`spike:tui:discovered` is still the TUI entry point rather than a no-argument
CLI mode:

```text
pandamate start <project>
pandamate stop <project>
pandamate open <project>
pandamate send <project> <text>
pandamate inbox list|lease|ack|apply|resolve|fail ...
pandamate timer add|list ...
pandamate memory set|list|check ...
pandamate project create|add|adopt|show ...
pandamate close-tab <project>
pandamate shutdown-all
pandamate status [--json]
pandamate event               # hook JSON on stdin
pandamate doctor
pandamate daemon start|stop|status
```

Commands are clients of the daemon. They do not edit SQLite directly.

### 2.3 TUI

The TUI is a projection and command surface. Today its launcher polls bounded
daemon project/event projections every 500 ms, overlays read-only tmux/workspace
evidence, and pushes validated updates to the OpenTUI child over process IPC.
Closing the TUI never stops the daemon or FirstMates. A true daemon subscription
stream remains a later replacement for polling.

### 2.4 Claude brain

The implemented `packages/agent-sdk` slice uses the TypeScript Claude Agent SDK
for bounded free-form conversation. A brain episode receives:

- a concise Pandamate system contract;
- a bounded current briefing;
- the current user request.

The live launcher currently gives the model no tools. It streams a resumable
episode with a 45-second deadline, rotates after 20 successful turns, and returns
a bounded answer to the Home input surface. Validated tools such as
`route_instruction`, `remember_decision`, `query_activity`, and
`request_attention`, durable conversation state, and a dedicated Conversation
screen are Phase 5 follow-ups. The model will never write SQLite or memory files
directly.

### 2.5 FirstMate adapter

The target architecture gives every FirstMate kind one adapter contract:

```text
validate(workspace, config)
buildLaunchSpec(project)
discoverActualState(project)
deliver(message)
requestSummary(project)
stop(project, mode)
recover(project, checkpoint)
```

Today `FirstMateSupervisor` shares one Claude Code launcher and specializes the
launch prompt/profile for `FirstMateArc`, `FirstMateGit`, and `DocResearch`.
`@pandamate/firstmate-kit` supplies the deterministic mailbox, status,
checkpoint, hook spool, and workspace-evidence boundary. The formal adapter
interface above, adapter-specific delivery/recovery, and per-profile capability
objects are not implemented yet.

### 2.6 Hook client

Claude Code command hooks pipe JSON to `pandamate event`. The client validates,
adds adapter/project identity, sends it to the daemon, and exits quickly.

Hooks never wait on model calls. If the daemon is unavailable, the client spools
the event atomically to a local directory. The daemon attempts up to 100 files
at startup and every second; the hook CLI also tries older files before the new
event. Recorded real Claude hook fixtures/configuration are still missing.

### 2.7 tmux runtime adapter

`packages/runtime-tmux` is the sole reusable process boundary for tmux
discovery, stable targets, lifecycle operations, and terminal opening. Callers
provide structured argument arrays; project-controlled values are never
interpolated into a shell command. Command execution is injectable so parsing
and exact argument boundaries can be tested without touching a real tmux
server.

The daemon owns reconciliation through this adapter. Spikes orchestrate real
demonstrations but consume the package instead of duplicating tmux execution or
discovery.

## 3. Technology baseline

### Core

- TypeScript with strict type checking.
- Node.js 26.5.0 pinned by `.nvmrc` for the current implementation; the eventual
  production LTS choice remains open.
- Claude Agent SDK for brain episodes and controlled tools.
- SQLite in WAL mode for operational durability.
- Zod or equivalent for every IPC, configuration, hook, and persisted payload.
- tmux as the initial terminal session backend.

### TUI decision gate

OpenTUI is the implemented candidate because its TypeScript API keeps the
product in one language and its native renderer supports a visually rich
interface.

The spike already proves normal alternate-screen cleanup, resize, Unicode,
keyboard navigation, daemon refresh, and testability. Final acceptance still
requires:

- stable alternate-screen restore after crash;
- resize, mouse, Unicode, clipboard, and tmux behavior;
- CPU below 2% while idle;
- bounded memory during a 24-hour run;
- packaging on the target macOS machine;
- testability without a real terminal.

If the remaining gate fails, Ratatui remains the fallback client. The daemon
protocol keeps that substitution local to the presentation layer.

### Packaging

Do not require a single-file binary in the first milestone. The Claude Agent SDK
ships platform-specific native dependencies, and the TUI candidate also has a
native renderer. Prefer a versioned application directory plus a small launcher.

## 4. IPC

Use a versioned request/response and subscription protocol over a Unix domain
socket:

```json
{
  "protocol": 1,
  "requestId": "req_...",
  "type": "instruction.create",
  "payload": {}
}
```

Requirements:

- peer restricted by filesystem permissions;
- maximum frame size;
- deadlines and cancellation;
- idempotency key for mutations;
- replay cursor for subscriptions;
- structured errors;
- forward-compatible unknown event handling.

No HTTP listener is required for MVP.

## 5. Runtime and state locations

The repository contains source and checked-in specification only. Live state
must not be stored inside a Git checkout, Arcadia tree, Yandex Disk, Dropbox, or
another synchronized/network filesystem.

On macOS, use an OS-local application data directory for:

- SQLite database and WAL;
- semantic Markdown memory;
- hook spool and dead letters;
- logs, backups, and migration metadata.

Use a short, user-private runtime path for the Unix socket and lock to stay
within Unix socket path-length limits. Exact paths are a Phase 0 decision and
must be overrideable for isolated tests.

## 6. Process and tmux model

Use one stable tmux session per FirstMate:

```text
firstmate-<project-slug>
```

Store both the tmux address and the full launch recipe. A tmux pane is not proof
of health; health combines:

- tmux session existence;
- launcher/Claude process existence;
- recent heartbeat;
- hook activity;
- FirstMate-declared state.

Opening a registered FirstMate links its window `0` into `pandamate:home` and
selects that Home tab. The FirstMate still owns its independent durable session;
closing the tab unlinks it and never kills the shared window. Unregistered
discovered sessions use the legacy separate-iTerm-window adapter because they
have no durable project slug. Other terminal-compatible fallbacks remain
isolated behind the same boundary.

Existing non-`pandamate:*` sessions are discovery evidence and may be adopted
without process restart. Stable tmux IDs, not user-visible names, are used for
destructive or attachment operations after discovery resolves the name.

## 7. Runtime states

```text
registered → starting → working ↔ waiting
                  │         │         │
                  ├────────►failed    │
                  └────────►recovering◄┘
                            │
                     sleeping / stopped
```

`desired_state` and `actual_state` are separate. Reconciliation moves actual
state toward desired state, never the reverse without recording why.

## 8. Timers

The implemented timer is a persisted one-shot instruction: when due, a 500 ms
scheduler atomically marks it fired and creates one ordinary queued mailbox
message. The following richer jobs remain target scope rather than current
behavior:

- heartbeat evaluation;
- message delivery retry;
- recovery retry;
- deferred instruction wake-up;
- periodic summary request;
- memory compaction/consistency check;
- event retention and database checkpoint;
- daemon self-health.

The current scheduler fires overdue pending timers once on startup. Timer
leases, recurring schedules, attempts, and configurable missed-run policies are
not implemented.
