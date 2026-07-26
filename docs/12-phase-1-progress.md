# 12. Phase 1 progress

## Implemented vertical slice

The first durable, non-AI vertical slice is runnable:

- strict domain validation for projects, workspaces, and idempotency keys;
- configuration with overrideable state and runtime directories;
- SQLite schema migrations and WAL mode;
- transactional project projections plus append-only audit events;
- idempotent mutation replay;
- cursor-bounded event queries;
- single-instance daemon lock;
- private versioned newline-framed Unix-socket protocol;
- one-request-per-connection client with deadline and frame limit;
- structured JSONL daemon logs;
- CLI daemon start/stop/status, project registration, status, desired
  start/stop, open skeleton, events, and doctor;
- top-level TUI Event Journal entered directly from Home with `e`.

Claude Code, Claude Agent SDK, and model calls are not used by this slice.

## Runtime locations

Live operational state is kept outside the synchronized source checkout:

```text
~/Library/Application Support/Pandamate/state.sqlite3
~/Library/Application Support/Pandamate/pandamated.jsonl
<private temporary runtime>/pandamated.sock
<private temporary runtime>/pandamated.lock
```

`PANDAMATE_STATE_DIR` and `PANDAMATE_RUNTIME_DIR` override these paths for
isolated tests and development.

## Demonstrated

The automated integration journey:

1. starts a real daemon on an isolated Unix socket;
2. registers three fake projects through the CLI;
3. changes Mandala's durable desired state to `running`;
4. reads project status and the Event Journal through the CLI;
5. gracefully stops and restarts the daemon;
6. verifies that both JSON projections are identical after restart.

Additional coverage verifies idempotent replay creates no duplicate event and
that project state plus its audit event commit in one transaction.

The real tmux/OpenTUI smoke also opens the Event Journal from Home, renders a
durable event, returns to Home, and restores the terminal cleanly on exit.

## Deferred hardening follow-ups

- rotation policy for structured logs;
- stronger runtime schema validation of successful response payloads;
- graceful shutdown deadline and forced fallback;
- database integrity details in `doctor`;
- SQLite backup/restore tooling, which is primarily a Phase 4 hardening item.

These do not block starting Phase 2 and remain tracked for the later hardening
phases. Real tmux start/stop/reconciliation is Phase 2. The current CLI `start`
and `stop` commands persist desired state; `open` reports that no supervised
target exists until the runtime adapter supplies one.
