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
     SQLite          memory/          tmux         Claude Agent SDK
        │                               │              │
        └──────── hooks/CLI ───── FirstMate sessions ──┘
```

The daemon is the only writer to operational state. TUI instances, hook clients,
and CLI commands submit typed commands to it.

## 2. Components

### 2.1 `pandamated`

A long-running deterministic process responsible for:

- owning the SQLite connection and migrations;
- serializing state transitions;
- serving the local IPC protocol;
- supervising tmux sessions and child launchers;
- scheduling health checks, retries, and maintenance;
- appending events and producing current projections;
- invoking the Claude brain only for semantic operations;
- materializing human-readable memory.

The daemon must remain useful when Claude authentication or the network is down.

### 2.2 `pandamate`

One executable with subcommands:

```text
pandamate                     # open TUI
pandamate start <project>
pandamate stop <project>
pandamate open <project>
pandamate send <project> <text>
pandamate status [--json]
pandamate event               # hook JSON on stdin
pandamate doctor
pandamate daemon install|start|stop|status
```

Commands are clients of the daemon. They do not edit SQLite directly.

### 2.3 TUI

The TUI is a projection and command surface. It subscribes to daemon events over
the socket, keeps a small local view model, and redraws only on data or animation
ticks. Closing the TUI never stops the daemon or FirstMates.

### 2.4 Claude brain

Use the TypeScript Claude Agent SDK for semantic routing, summarization, and
conversation. A brain episode receives:

- a concise Pandamate system contract;
- a bounded current briefing;
- the current user request;
- only explicitly retrieved memory or event slices;
- narrow MCP/SDK tools for Pandamate operations.

The model cannot write SQLite or memory files directly. It calls validated tools
such as `route_instruction`, `remember_decision`, `query_activity`, and
`request_attention`.

### 2.5 FirstMate adapter

Every FirstMate kind implements one adapter contract:

```text
validate(workspace, config)
buildLaunchSpec(project)
discoverActualState(project)
deliver(message)
requestSummary(project)
stop(project, mode)
recover(project, checkpoint)
```

The initial adapters may share a Claude Code launcher and differ only in
instructions, tools, and VCS policy.

### 2.6 Hook client

Claude Code command hooks pipe JSON to `pandamate event`. The client validates,
adds adapter/project identity, sends it to the daemon, and exits quickly.

Hooks must never wait on model calls. If the daemon is unavailable, the client
spools the event atomically to a local directory; the daemon imports the spool
on startup.

### 2.7 tmux runtime adapter

`packages/runtime-tmux` is the sole reusable process boundary for tmux
discovery, stable targets, lifecycle operations, and terminal opening. Callers
provide structured argument arrays; project-controlled values are never
interpolated into a shell command. Command execution is injectable so parsing
and exact argument boundaries can be tested without touching a real tmux
server.

The daemon will own reconciliation through this adapter. Spikes may orchestrate
real demonstrations, but must consume the package instead of duplicating tmux
execution or discovery.

## 3. Technology baseline

### Core

- TypeScript with strict type checking.
- Node.js LTS for daemon and CLI.
- Claude Agent SDK for brain episodes and controlled tools.
- SQLite in WAL mode for operational durability.
- Zod or equivalent for every IPC, configuration, hook, and persisted payload.
- tmux as the initial terminal session backend.

### TUI decision gate

Preferred candidate: OpenTUI, because its TypeScript API keeps the product in
one language and its native renderer supports a visually rich interface.

Before committing, complete a spike that proves:

- stable alternate-screen restore after crash;
- resize, mouse, Unicode, clipboard, and tmux behavior;
- CPU below 2% while idle;
- bounded memory during a 24-hour run;
- packaging on the target macOS machine;
- testability without a real terminal.

If the spike fails, use Ratatui as a separate UI client. The daemon protocol
makes this substitution local to the presentation layer.

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

Opening a FirstMate creates a new terminal window and attaches a separate tmux
client. The Pandamate client remains on the home control deck. The current
adapter supports iTerm; other terminal-compatible adapters remain isolated
behind the same action.

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

Timers are persisted jobs, not in-memory `setTimeout` calls:

- heartbeat evaluation;
- message delivery retry;
- recovery retry;
- deferred instruction wake-up;
- periodic summary request;
- memory compaction/consistency check;
- event retention and database checkpoint;
- daemon self-health.

On startup, overdue timers are claimed with a lease and processed according to
their missed-run policy: run once, skip, or require reconciliation.
