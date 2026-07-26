# 15. Phase 3 progress

## Durable mailbox

The Phase 3 vertical slice now has one deterministic instruction path:

- `pandamate send <project> <instruction>` creates a bounded, prioritized,
  idempotent queued message;
- FirstMates lease ordered batches through `@pandamate/firstmate-kit`;
- transitions are guarded as
  `leased → acknowledged → applied → resolved`, with explicit failure;
- expired/failed deliveries are reconciled by the daemon and become dead
  letters after five attempts;
- every mutation and retry emits an audit event in the same SQLite transaction.

The integration test leases an instruction, restarts the daemon mid-delivery,
then acknowledges, applies, and resolves it exactly once.

## Status and checkpoints

The FirstMate kit reports bounded status and creates structured checkpoints.
Status updates the project activity/attention projection transactionally;
checkpoints retain completed/pending steps, external side effects, and the next
safe action. Neither API accepts terminal output or an unbounded transcript.

## Hooks and offline spool

`pandamate event` and `HookSpoolClient` implement the fast telemetry boundary:

- JSON object payloads are limited to 64 KiB and normalized by event type;
- a stable hook ID deduplicates retries in SQLite;
- when the daemon is unavailable, an atomic mode-0600 JSON file is written
  under the private state-directory spool;
- the next hook invocation replays prior files in order before delivering the
  new event.

## Persisted timers

One-shot timers are durable SQLite entities. The daemon scheduler atomically
marks each due timer fired and creates an ordinary queued message. Repeated
scheduler passes cannot create a duplicate message.

## Remaining Phase 3 gate

- recorded Claude Code hook fixtures and generated example configuration;
- automatic spool replay independent of the next hook invocation;
- urgent interruption policy with safe-point evidence;
- an end-to-end fixture that consumes the public FirstMate kit rather than
  invoking protocol calls from the test harness.
