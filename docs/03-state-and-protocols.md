# 03. State, events, and protocols

## 1. Source-of-truth rule

Operational truth lives in SQLite. Semantic truth is materialized as reviewed,
human-readable Markdown. Claude transcripts and tmux output are evidence, not
authoritative state.

Only the daemon mutates operational state. Every mutation is a transaction that
includes its audit event.

## 2. Core entities

### `project`

| Field | Meaning |
|---|---|
| `id` | stable opaque ID |
| `slug` | human-readable unique name |
| `title` | display name |
| `kind` | `arc`, `git`, or `docs` |
| `workspace` | canonical absolute path |
| `desired_state` | requested lifecycle state |
| `actual_state` | observed lifecycle state |
| `tmux_target` | unique stable `$session_id` resolved from observed tmux evidence |
| `launch_profile` | versioned adapter configuration |
| `current_summary` | bounded FirstMate summary |
| `attention_level` | none, info, action, urgent |
| `last_heartbeat_at` | last health signal |
| `version` | optimistic concurrency version |

### `agent_session`

Tracks a concrete FirstMate or Pandamate brain episode:

- project, kind, Claude session ID, tmux pane, PID;
- started/ended timestamps and reason;
- context-generation number;
- last hook and checkpoint;
- parent episode when one replaces another.

### `message`

An instruction or response:

- stable ID and idempotency key;
- source, target, project, priority;
- original text and optional structured intent;
- status and status timestamps;
- correlation and causation IDs;
- delivery attempts;
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
  "actor": {"kind": "firstmate", "id": "agt_..."},
  "correlationId": "cmd_184",
  "causationId": "evt_1840",
  "schemaVersion": 1,
  "payload": {}
}
```

Payloads are versioned and immutable. Corrections are new events.

### `decision`

Represents active semantic truth:

- stable topic key, value/summary, scope;
- status: active or superseded;
- effective timestamp;
- source message/event;
- superseded decision ID;
- Markdown target and checksum.

### `checkpoint`

A safe continuation boundary declared by a FirstMate:

- current goal and phase;
- completed and pending steps;
- repository/document evidence;
- external side effects already performed;
- next safe action;
- resumable Claude session ID if useful;
- adapter-specific recovery payload.

### `timer`

Persisted schedule with due time, policy, lease, attempts, and idempotency key.

## 3. Instruction lifecycle

```text
created → queued → delivered → acknowledged → applied → resolved
                     │              │            │
                     └──────────────┴────────────► failed/dead-letter
```

Definitions:

- **created:** durable record exists;
- **queued:** routing target and delivery policy are known;
- **delivered:** target inbox accepted the message;
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

FirstMate responses are typed:

```json
{
  "messageId": "msg_...",
  "disposition": "accepted",
  "summary": "Will switch after the current test run",
  "applyAfter": "checkpoint",
  "attention": "none"
}
```

Priority:

- `normal`: consume at next safe loop checkpoint;
- `high`: consume after current tool call/atomic step;
- `urgent`: request interruption, then reconcile before continuing.

`tmux send-keys` is an emergency adapter, not the durable bus.

## 5. FirstMate status contract

Every FirstMate publishes a bounded status document:

```json
{
  "protocolVersion": 1,
  "projectId": "prj_...",
  "state": "working",
  "activity": "Running authentication tests",
  "goal": "Fix mobile authentication",
  "progress": {"kind": "steps", "done": 3, "total": 5},
  "iteration": 18,
  "attention": null,
  "safeToInterrupt": false,
  "checkpointId": "chk_...",
  "timestamp": "2026-07-26T14:42:00+03:00"
}
```

Status text and payloads have strict size limits. Raw terminal output never
enters the main Pandamate briefing automatically.

## 6. Hook normalization

Store the original hook payload in bounded archival form, then normalize it to
stable internal events such as:

- `session.started`, `session.compacted`, `session.ended`;
- `agent.tool.started`, `agent.tool.completed`, `agent.tool.failed`;
- `agent.waiting_permission`, `agent.idle`;
- `task.created`, `task.completed`;
- `heartbeat.received`;
- `checkpoint.created`.

Hook schemas are treated as an external versioned API. Unknown fields are
preserved; unknown event types do not crash ingestion.

## 7. Idempotency and concurrency

- Every external mutation accepts an idempotency key.
- Hook deduplication uses session, event type, tool-use/prompt ID, and payload
  fingerprint.
- Timers and message deliveries use leases with expiry.
- Project mutations check `version`.
- Side-effecting steps record `prepared`, `executing`, and `observed` states.
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
