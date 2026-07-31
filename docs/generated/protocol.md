# Generated protocol and domain reference

<!-- GENERATED FILE. DO NOT EDIT. Run `pnpm docs:generate`. -->

Sources: `packages/protocol/src/index.ts`, `packages/domain/src/index.ts`, `spikes/tui/src/control-protocol.ts`, `spikes/tui/src/index.ts`.

## Daemon IPC

- Protocol version: `1`
- Maximum frame size: `1048576` bytes

### Request types

- `system.ping`
- `system.shutdown`
- `system.drain`
- `project.list`
- `project.get`
- `project.open`
- `project.tab.close`
- `project.create`
- `project.desired.set`
- `project.tmux.adopt`
- `project.restart`
- `project.rename`
- `event.list`
- `message.create`
- `message.list`
- `message.lease`
- `message.transition`
- `firstmate.status.report`
- `checkpoint.create`
- `timer.create`
- `timer.list`
- `hook.ingest`
- `decision.record`
- `decision.list`
- `memory.check`

## Domain vocabularies

| Vocabulary | Values |
|---|---|
| Project kinds | `arc`, `git`, `docs` |
| FirstMate profiles | `FirstMateArc`, `FirstMateGit`, `DocResearch` |
| Desired states | `running`, `stopped` |
| Actual states | `registered`, `starting`, `running`, `working`, `waiting`, `failed`, `recovering`, `sleeping`, `stopped` |
| Message priorities | `normal`, `high`, `urgent` |
| Message statuses | `queued`, `leased`, `acknowledged`, `applied`, `resolved`, `failed`, `dead-letter` |

## TUI control protocol

### Actions

- `session.open`
- `session.graceful-shutdown`
- `session.reset`
- `session.kill`
- `project.start`
- `project.rename`
- `pandamate.submit`
- `pandamate.reload`
- `pandamate.shutdown-all`

### Internal screen states

- `home`
- `input`
- `rename`
- `events`
- `services`
- `project`
- `confirm-graceful`
- `confirm-reset`
- `confirm-kill`
- `confirm-shutdown-all`
- `shutdown`
