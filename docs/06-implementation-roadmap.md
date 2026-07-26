# 06. Implementation roadmap

## 1. Delivery strategy

Build vertical slices. Every milestone ends with a runnable artifact and a
demonstration. Do not implement the full database, daemon, or TUI in isolation.

## Phase 0 — technical spikes

### Goals

- prove OpenTUI inside tmux on the target Mac;
- prove Claude Agent SDK streaming, session IDs, resume, cancellation, and hooks;
- prove safe tmux switching and return;
- measure SQLite durability and hook latency.

### Outputs

- `spikes/tui`;
- `spikes/agent-sdk`;
- `spikes/tmux`;
- decision updates in `08-decisions.md`.

### Exit criteria

- 24-hour idle TUI run without growth or terminal corruption;
- resize/mouse/Unicode/reduced-motion demo;
- streamed brain response cancellable from TUI;
- hook event reaches daemon prototype in under 100 ms locally;
- chosen TUI technology is explicitly accepted.

## Phase 1 — durable core and CLI

**Status:** vertical-slice exit criteria met; Phase 2 is next. The durable core,
project registration/projections, single-instance daemon, Unix socket, event
query, CLI lifecycle skeleton, structured log, doctor, and restart
demonstration are implemented. Real start/open/stop supervision moves into
Phase 2.

### Build

- package/workspace structure;
- configuration loading and validation;
- SQLite schema, migrations, WAL, event append;
- daemon single-instance lock and Unix socket;
- project CRUD and state projections;
- CLI status/start/stop/open skeleton;
- structured logging and `doctor`.

### Demonstration

Register three fake projects, restart daemon, and show identical state and event
history through CLI.

## Phase 2 — tmux supervision

**Status:** complete. `packages/runtime-tmux` owns validated argument-array
execution, stable targets, discovery, lifecycle primitives, and the
separate-iTerm-window adapter. The daemon reconciles durable desired state
against observed tmux sessions and deterministic fixture heartbeats. Live
non-control sessions can be adopted without process restart, and the TUI now
refreshes daemon projections and cursor-bounded events instead of relying on a
one-time launch snapshot.

### Build

- tmux capability detection;
- stable target naming;
- launch profile validation;
- start/open/stop/restart;
- desired/actual reconciliation;
- process and heartbeat health calculation;
- fake FirstMate fixture.

### Demonstration

Start two fixture FirstMates, kill one unexpectedly, recover it, switch into its
tmux target, and return to Pandamate.

## Phase 3 — hooks, mailbox, and timers

### Build

- `pandamate event` fast client and offline spool;
- normalized Claude hook ingestion;
- inbox leasing, acknowledgement, application, and dead letters;
- normal/high/urgent policy;
- persisted timer scheduler;
- bounded status and checkpoint protocol;
- FirstMate integration kit and example configurations.

### Demonstration

Route an instruction through all lifecycle states while the TUI/daemon is
restarted midway; no duplicate application occurs.

## Phase 4 — memory and recovery

### Build

- decision store and supersession;
- Markdown materializer with atomic writes;
- bounded `MEMORY.md` index generator;
- memory consistency checker and reconciliation command;
- checkpoints and recovery classification;
- startup reconciliation and report;
- backups and restore tooling.

### Demonstration

Change a UI preference, force-kill the system at controlled points, restart, and
show the new preference active with provenance and no conflicting old rule.

## Phase 5 — Pandamate brain

### Build

- Agent SDK client and episode lifecycle;
- bounded briefing builder;
- narrow validated tools;
- natural-language project routing;
- streamed responses and cancellation;
- explicit memory-mutation workflow;
- context budget telemetry and rotation;
- offline degradation.

### Demonstration

Ask “who needs me?”, route a change to Mandala, receive FirstMate acknowledgement,
and rotate the brain session while preserving continuity.

## Phase 6 — production TUI

### Build

- application shell and event subscription;
- Home, Project, Conversation, Timeline, Memory, Sessions, Diagnostics;
- command palette and chat input;
- animation and themes;
- responsive layouts;
- mouse, keyboard, accessibility, reconnect behavior;
- tmux navigation and return affordance.

### Demonstration

Run the complete visual journey using real FirstMate sessions and recorded error,
recovery, and attention scenarios.

## Phase 7 — real adapters

### Build

- FirstMateArc profile and Arcadia-specific validation;
- FirstMateGit profile;
- FirstMateDocs profile;
- adapter-specific capabilities and safe recovery;
- project onboarding wizard;
- migration path for existing manually started FirstMates.

### Demonstration

One real project of every kind is started, instructed, observed, opened, stopped,
and recovered from Pandamate.

## Phase 8 — hardening and daily use

### Build

- launch-at-login service for macOS;
- crash reporting and support bundle;
- retention and backup defaults;
- permission and secret review;
- performance profiling;
- failure injection suite;
- upgrade/rollback procedure;
- user documentation.

### Exit criteria

- seven-day dogfood run;
- forced power-loss simulation passes;
- no unbounded context, memory, event-query, or UI growth;
- acceptance matrix in `07-testing-and-acceptance.md` passes;
- implementation spec updated to match shipped behavior.

## 2. Suggested repository layout

```text
apps/
├── cli/
├── daemon/
└── tui/
packages/
├── domain/
├── protocol/
├── storage/
├── runtime-tmux/
├── agent-sdk/
├── firstmate-kit/
├── memory/
└── testkit/
fixtures/
├── fake-firstmate/
└── hook-payloads/
docs/
```

Keep domain transitions independent from Node process, SQLite, tmux, Claude, and
TUI APIs. Adapters surround a deterministic core.

## 3. Implementation rules

- strict TypeScript; no unchecked external JSON;
- migrations and protocol schemas reviewed like public APIs;
- every mutation emits an event in the same transaction;
- tests use fake clock and deterministic IDs;
- no model call in lifecycle, durability, or navigation code;
- no direct database access outside storage package;
- no direct tmux calls outside runtime adapter;
- no raw shell interpolation for workspace, prompt, or tmux target;
- every background job has timeout, retry policy, and observability;
- documentation and decisions change in the same commit as behavior.

## 4. Release shape

Initial target: one macOS user and local tmux.

Version milestones:

- `0.1`: durable daemon + CLI + fixture FirstMate;
- `0.2`: hooks, mailbox, recovery, memory;
- `0.3`: brain and functional TUI;
- `0.4`: visual polish and three real adapters;
- `1.0`: proven daily-use reliability and upgrade/restore path.
