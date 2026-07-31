# 03. State, events, and protocols

## 1. Source-of-truth rule

Operational truth lives in SQLite. Semantic truth is materialized as reviewed,
human-readable Markdown. Claude transcripts and tmux output are evidence, not
authoritative state.

Only the daemon mutates operational state. Every mutation is a transaction that
includes its audit event.

This document distinguishes the schema implemented in migration version 8 from
target extensions. Unmarked fields and transitions below describe the current
implementation as of 2026-07-31.

## 2. Core entities

### `project`

| Field | Meaning |
|---|---|
| `id` | stable opaque ID |
| `slug` | human-readable unique name |
| `title` | display name |
| `custom_display_name` | optional bounded Fleet label override |
| `kind` | `arc`, `git`, or `docs` |
| `workspace` | canonical absolute path |
| `desired_state` | requested lifecycle state |
| `actual_state` | observed lifecycle state |
| `tmux_target` | unique stable `$session_id` resolved from observed tmux evidence |
| `tmux_session_name` | durable human-readable runtime name, even while stopped |
| `current_summary` | bounded FirstMate summary |
| `attention_level` | none, info, action, urgent |
| `last_heartbeat_at` | last health signal |
| `version` | monotonic projection version; optimistic client checks are future work |

### `agent_session` (target, not persisted yet)

Tracks a concrete FirstMate or Pandamate brain episode:

- project, kind, Claude session ID, tmux pane, PID;
- started/ended timestamps and reason;
- context-generation number;
- last hook and checkpoint;
- parent episode when one replaces another.

### `message`

An instruction or response:

- stable ID; the creating command has a separately stored idempotency result;
- project, original bounded text, and `normal`/`high`/`urgent` priority;
- status, lease owner/expiry, created/updated timestamps, and attempts;
- acknowledgement and resolution summary.

### `event`

Append-only envelope:

```json
{
  "id": "evt_01...",
  "sequence": 1842,
  "occurredAt": "2026-07-26T14:02:13.120+03:00",
  "recordedAt": "2026-07-26T14:02:13.128+03:00",
  "type": "instruction.acknowledged",
  "projectId": "prj_...",
  "actor": {"kind": "daemon", "id": "firstmate:mandala"},
  "correlationId": "cmd_184",
  "causationId": "evt_1840",
  "schemaVersion": 1,
  "payload": {}
}
```

Payloads are versioned and immutable. Corrections are new events.

### `decision`

Represents active semantic truth:

- stable topic key, value, summary, and bounded source text;
- status: active or superseded;
- created/superseded timestamps;
- superseded decision ID;

The generated Markdown target and checksum are derived, not columns on the
decision record.

### `checkpoint`

A safe continuation boundary declared by a FirstMate:

- goal and phase;
- completed and pending steps;
- external side effects already performed;
- next safe action;

Repository evidence, resumable session identity, and adapter recovery payloads
remain target extensions.

### `timer`

Current timers contain a project, due time, text, priority, pending/fired/
cancelled status, and the ID of the queued message created when they fire. Timer
leases, attempts, recurring policy, and cancellation commands are not yet
implemented.

## 3. Instruction lifecycle

```text
queued → leased → acknowledged → applied → resolved
           │               │            │
           └───────────────┴────────────► failed → queued/dead-letter
```

Definitions:

- **queued:** routing target and delivery policy are known;
- **leased:** a FirstMate owns a bounded delivery lease; the audit event is
  named `instruction.delivered`;
- **acknowledged:** FirstMate explicitly understood it;
- **applied:** it changed the active plan or behavior;
- **resolved:** requested outcome is complete or intentionally closed.

Never infer acknowledgement from successful `tmux send-keys`.

## 4. Mailbox protocol

Normal delivery is pull-at-safe-point:

1. daemon stores the message;
2. FirstMate loop or hook requests pending messages;
3. daemon leases a batch;
4. FirstMate acknowledges receipt;
5. FirstMate reports application or rejection;
6. daemon completes or retries the lease.

The public `FirstMateClient` exposes guarded transition calls. Conceptually a
response is typed as:

```json
{
  "messageId": "msg_...",
  "summary": "Will switch after the current test run",
  "status": "acknowledged"
}
```

Priority:

- `normal`, `high`, and `urgent` determine lease ordering today;
- safe-point consumption and actual urgent interruption are policy still to be
  implemented and proved.

`tmux send-keys` is an emergency adapter, not the durable bus.

## 5. FirstMate status contract

Every FirstMate publishes a bounded status document:

```json
{
  "projectSlug": "mandala",
  "state": "working",
  "activity": "Running authentication tests",
  "goal": "Fix mobile authentication",
  "progress": {"kind": "steps", "done": 3, "total": 5},
  "iteration": 18,
  "attention": "none",
  "safeToInterrupt": false,
  "checkpointId": "chk_...",
  "timestamp": "2026-07-26T14:42:00+03:00"
}
```

Status text and payloads have strict size limits. Raw terminal output never
enters the main Pandamate briefing automatically.

## 6. Hook normalization

The current hook boundary validates a bounded object, deduplicates by `hookId`,
and appends `hook.<eventType>` with the supplied payload plus hook metadata. It
does not yet map recorded Claude Code payloads into the richer stable vocabulary
below:

- `session.started`, `session.compacted`, `session.ended`;
- `agent.tool.started`, `agent.tool.completed`, `agent.tool.failed`;
- `agent.waiting_permission`, `agent.idle`;
- `task.created`, `task.completed`;
- `heartbeat.received`;
- `checkpoint.created`.

Unknown payload fields are preserved inside the bounded event payload and
unknown validated event names do not crash ingestion. Recorded fixtures and
schema-specific redaction/normalization remain Phase 3 work.

## 7. Idempotency and concurrency

- Project creation/state/adoption/restart/rename, message creation, timer
  creation, and decision recording accept idempotency keys.
- Hook deduplication uses the caller-supplied stable hook ID.
- Message deliveries use leases with expiry; timers currently do not.
- Project `version` increments on mutation, but optimistic client version checks
  are not implemented.
- `prepared`/`executing`/`observed` side-effect records remain target recovery
  work.
- “Exactly once” is not promised across arbitrary external systems; Pandamate
  provides at-least-once attempts plus reconciliation.

## 8. Activity projections

The home timeline is a derived, curated projection. It suppresses repetitive
heartbeats and low-value tool events. Detailed views can query:

- project history;
- instruction trace;
- session lifecycle;
- recovery trace;
- memory changes;
- raw normalized hooks.

All queries are cursor-based and bounded.

## 9. Existing-session adoption

Adoption accepts a registered project and a non-control tmux session name. The
daemon must observe at least one live pane before persisting the resolved stable
session ID. The project target, desired/actual running state, version increment,
idempotent command result, and `project.tmux.adopted` event commit atomically.

Adoption never restarts the existing process. Rebinding an already associated
project or sharing one stable target between projects requires a separate,
explicit future workflow and is rejected by the current protocol.
