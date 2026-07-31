# 07. Testing and acceptance

## Current automated evidence — 2026-07-31

`pnpm check` type-checks 14 workspace projects. `TMPDIR=/tmp pnpm test` passes
135 tests covering domain/protocol validation, SQLite migrations and
transactions, memory materialization, Agent SDK streaming fixtures, Unix-socket
client/server IPC, hook spooling, FirstMate workspace evidence, tmux argument
boundaries/tabs/shutdown, TUI model/control protocol, daemon restart,
supervision/recovery, CLI restart, and full shutdown.

The short `TMPDIR` matters in harnesses whose system temporary path is already
long: two supervisor tests derive their configured runtime directory below a
temporary fixture, and otherwise can hit the production 100-byte Unix socket
limit before the behavior under test. This is a test-fixture portability issue,
not a passing acceptance result; it should eventually be fixed in the tests.

The lists below are the complete target matrix. Items without evidence in the
progress/audit documents remain open; notably property/fuzz testing, recorded
real Claude hooks, brain tool routing, memory reconciliation, power-loss
classification, backup/restore, launch-at-login, and long-duration acceptance.

## 1. Test layers

### Unit

- tmux target/socket validation, argument boundaries, and discovery parsing;
- state machines and transition guards;
- message lifecycle;
- timer missed-run policies;
- decision supersession;
- briefing size selection;
- recovery classification;
- schema compatibility.

### Property and fuzz

- arbitrary event sequences preserve invariants;
- duplicate commands remain idempotent;
- malformed hook/IPC frames never crash daemon;
- Markdown materialization is deterministic;
- terminal width and Unicode combinations do not panic.

### Integration

- daemon + SQLite + socket;
- real tmux with fake FirstMate;
- durable live-session adoption across daemon restart on an isolated tmux server;
- hook client spool/replay;
- Claude SDK fixture and recorded streams;
- memory DB/Markdown reconciliation;
- launch-at-login configuration.

### End-to-end

- start, instruct, observe, open, return, stop;
- natural-language routing and acknowledgement;
- daemon restart during delivery;
- TUI disconnect/reconnect and cursor-based polling replay;
- FirstMate crash and automatic recovery;
- context rotation with semantic continuity.

### Failure injection

Kill the daemon or process:

- before and after transaction commit;
- during Markdown materialization;
- after external side effect but before observation;
- during message lease;
- during tmux creation;
- during Claude streaming;
- while hook spool is written.

## 2. Core invariants

1. At most one daemon owns a state directory.
2. Sequence numbers are monotonic.
3. An acknowledged decision has durable DB and Markdown representation.
4. One decision topic has at most one active value.
5. `actual_state=working` requires evidence, not only desired state.
6. A resolved message has an acknowledgement or an explicit terminal reason.
7. No project command can target a different canonical workspace.
8. Brain briefing and status payloads remain bounded.
9. Closing the TUI does not stop supervised work.
10. Recovery never blindly repeats an ambiguous external side effect.

## 3. Acceptance scenarios

### A. Everyday control

- Start Pandamate.
- See all projects and their current activity immediately.
- Ask for overall status.
- Send a project instruction.
- Observe queued, acknowledged, applied, and resolved states.

### B. Direct steering

- Select a FirstMate.
- Open its tmux session.
- Talk directly.
- Return to the exact Pandamate home screen.
- See the direct interaction reflected in later status.

### C. Durable preference

- Tell Pandamate to change an interface behavior.
- Receive acknowledgement only after persistence.
- Terminate every Pandamate process.
- Restart and verify the behavior, provenance, and superseded old value.

### D. Power recovery

- Keep two FirstMates running and one stopped.
- Simulate abrupt shutdown.
- Restart.
- Restore the two safe desired-running sessions.
- Keep the stopped project stopped.
- Present a precise recovery report.

### E. Ambiguous side effect

- Interrupt after an external action but before completion event.
- Restart.
- Observe the external system.
- Avoid duplicate execution.
- Ask Panda if observation cannot resolve the ambiguity.

### F. Long-duration context

- Generate months-equivalent event history.
- Start a fresh brain episode.
- Verify briefing remains within its configured budget.
- Retrieve an old detail only on explicit request.
- Rotate context without losing current decisions or pending obligations.

## 4. Performance budgets

| Operation | Budget |
|---|---|
| TUI initial render with live daemon | 500 ms |
| deterministic command p95 | 100 ms |
| hook ingestion p95 | 100 ms |
| status subscription update p95 | 100 ms |
| idle TUI CPU | <2% target |
| idle daemon CPU | effectively zero between timers |
| home project count | at least 100 without degradation |
| event store | at least 1 million events with bounded queries |

Model response latency is displayed but not included in deterministic budgets.

## 5. Compatibility matrix

Required:

- current target macOS;
- zsh;
- tmux;
- terminal true color and 256-color fallback;
- narrow and wide terminal sizes;
- Claude Code/Agent SDK version pinned by lockfile.

Optional after MVP:

- iTerm2-specific integration;
- Kitty;
- Linux launch service;
- alternate session backends.

## 6. Definition of done for 1.0

- all required acceptance scenarios automated or repeatably scripted;
- seven days of real usage without state loss;
- restore from backup demonstrated;
- upgrade and rollback demonstrated;
- memory consistency check is clean;
- security review has no unresolved critical issue;
- visual-design review complete;
- docs describe shipped behavior;
- Panda can operate normal work entirely from Pandamate.
