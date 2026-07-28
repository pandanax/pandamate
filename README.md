# Pandamate

Pandamate is a local, durable control plane for long-running Claude Code
orchestrators (“FirstMates”). It is the home screen through which Panda starts,
observes, directs, resumes, and opens project-level agents.

The product is intentionally thin:

- Pandamate owns navigation, durable state, messaging, recovery, and visibility.
- A FirstMate owns the detailed work inside one project.
- Workers spawned by a FirstMate remain invisible to Pandamate unless summarized
  by that FirstMate.
- Claude context is disposable. Durable external state is authoritative.

## Robot entry point

If the instruction is simply **“continue developing Pandamate”**, start here
and treat this section as the current handoff.

### Current status — 2026-07-26

Phase 1 has a working vertical slice:

- durable SQLite storage with migrations and WAL;
- transactional project mutations plus append-only events;
- idempotency keys and cursor-bounded Event Journal queries;
- single-instance daemon with a private versioned Unix socket;
- CLI for daemon lifecycle, project registration/status, desired start/stop,
  open skeleton, events, and doctor;
- OpenTUI Home, Fleet, Project, stop confirmation, and top-level Event Journal;
- a separate Pandamate Services projection for `home`, `write`, probes, and
  future service runtimes; these control-plane sessions never enter Fleet;
- existing non-control tmux sessions discovered without restarting them;
- `o` opens a FirstMate as a tmux tab inside the attached `pandamate:home`
  session instead of spawning a separate terminal window. Window `0` of the
  project session is linked into home (the FirstMate keeps running in its own
  durable session), tabs become visible via `status on`, and the client selects
  the new tab; switch between home and FirstMates with the tmux prefix and a
  window number. Re-opening an already linked project just selects its tab.
  Targets use stable session ids (`$N`) so the colon in `pandamate:home` never
  collides with tmux `session:window` target parsing. The legacy iTerm adapter
  (`openSessionInNewITermWindow`) remains available as a separate-window
  fallback.
- Closing a tab is the safe inverse of opening it. `closeControlTab`
  (protocol `project.tab.close`, CLI `pandamate close-tab <project>`) unlinks the
  project window from `pandamate:home` while the FirstMate keeps running in its
  own durable session, returns focus to the home base window, and hides the tab
  strip again once the last project tab is gone so home is a clean full-screen
  surface. It is idempotent and a safe no-op when home is down, the project
  session is gone, or it was never a tab. Never `kill-window` a project tab
  directly — that destroys the shared FirstMate window; unlink instead.
- Tab teardown is automatic: before the supervisor stops, restarts, or recovers
  a FirstMate (any `killSession`), it first detaches that project's home tab, so
  `x`, a desired stop, a restart, and heartbeat recovery never leave an orphan
  tab behind. Detach failures are logged and never block the teardown.
- `g` asks the selected FirstMate to shut down gracefully by typing the shutdown
  instruction into the active pane of its tmux window `0`; `x` remains the
  separately confirmed immediate whole-session kill.
- a gracefully stopped FirstMate remains in the Fleet as inactive so its
  project identity survives the runtime session; `r` asks a running FirstMate
  to gracefully stop its current crew and then deploy Watcher and service
  windows again without closing the main pane.
- `s` starts a stopped FirstMate again from its project view and gives back the
  tab that was lost with it. A stopped project has no tmux session and no Home
  tab left, so `o`, `g`, `r`, and `x` have nothing to address; the start request
  travels by durable project slug (`project.start`) instead, the daemon marks
  the project as wanted running, and the supervisor rebuilds session, FirstMate,
  and Watcher on its next pass. Pandamate then waits for that runtime to exist —
  up to 30 seconds, asking the daemon rather than tmux, because a session name
  outlives its session — and opens the project's Home tab itself, so the action
  answers twice: `starting` as soon as the start is durably accepted, then the
  tab number to switch to. A tab that cannot be opened never turns a successful
  start into a failure; it says so and leaves `o`. It is not confirmed — it
  creates work rather than destroying it, and `x` undoes it. Fleet items
  Pandamate only discovered carry no slug and stay unstartable. The project
  footer now lists only what that item can actually do now. Decision:
  [D-029](docs/08-decisions.md).
- `X` closes all of Pandamate, gracefully, in one action — `pandamate
  shutdown-all` does the same headlessly. The daemon is drained first (`system.
  drain`: supervision pauses and every project is durably marked stopped, so
  nothing is relaunched now and nothing returns by itself later), every
  `firstmate-*` session is then asked to shut itself down — crew dismissed,
  worktrees released, Arcadia workspaces unmounted, its own session closed last
  — and Pandamate waits for each one, forcing only what outlasts
  `PANDAMATE_SHUTDOWN_GRACE_MS` (five minutes by default). The daemon stops next,
  and `pandamate:*` windows close last with `pandamate:home` at the very end,
  since that is the window the shutdown itself runs in. tmux sessions outside
  the `firstmate-*` and `pandamate:*` namespaces are never touched, only
  reported. A live progress screen shows each session as it closes; a report
  says `forced` only when Pandamate really killed something. Full record:
  [docs/17-full-shutdown.md](docs/17-full-shutdown.md).
- a project's Watcher is deployed by the supervisor, not asked for in a prompt.
  A workspace that declares one — executable `.pandamate/watch`,
  `firstmate/bin/fm-watch`, or `bin/fm-watch` — gets it as window `watch` of its
  own `firstmate-<slug>` session the moment the FirstMate launches, and gets it
  back whenever the window disappears, bounded by a backoff and five consecutive
  redeploys. The session name is published as `PANDAMATE_TMUX_SESSION` in the
  launch environment and in the session's tmux environment, so the Watcher and
  anything the FirstMate opens later agree on one session. Watchers armed by a
  FirstMate's own Stop hook and adopted sessions are left alone; see
  [D-028](docs/08-decisions.md). An arc FirstMate whose workspace is product
  code carries no watcher of its own — its `fm-watch` lives in the arc
  FirstMate's separate home — so for `arc` projects the supervisor also looks in
  that home, derived from the workspace's `.arc` root
  (`<arcRoot>/junk/pandanax/firstmate`) with no configuration needed, when the
  workspace declares none; `PANDAMATE_FIRSTMATE_HOME` optionally overrides the
  derived path, and git projects, which own their watcher, are unaffected
  ([D-031](docs/08-decisions.md)).
- `i` opens a real Pandamate writing surface. A folder path can be pasted or
  dragged there. Pandamate detects a configured FirstMate from project-local
  Claude settings and repository markers, or accepts an explicit
  `FirstMateArc`, `FirstMateGit`, or `DocResearch` profile, then registers and
  starts the supervised project. Registered Fleet items show that profile.
- Existing FirstMate workspaces contribute their watcher liveness beacon and
  latest bounded `*.status` line to the daemon projection, so Selected shows a
  real heartbeat age and the latest meaningful status instead of reporting the
  signal as unavailable.
- `.claude/skills/create-project` gives the Pandamate brain the same durable
  folder-onboarding workflow and explains the concrete FirstMate runtime
  identity.

Phase 2 is complete. Reusable tmux discovery, stable target validation,
argument-array execution, isolated socket support, and the iTerm opening adapter
live in `packages/runtime-tmux`. The daemon now supervises durable projects,
uses heartbeat evidence from the deterministic fake FirstMate, recovers missing
or stale runtimes, and preserves stopped projects in Fleet. Registered projects
can also adopt a live non-control tmux session without restarting its process.
The TUI refreshes daemon projects and replays cursor-bounded events every
500 ms, retaining its last good projection through temporary disconnects.

Phase 3 now has a runnable durable vertical slice: queued/leased instructions,
guarded acknowledgement/application/resolution, retry and dead-letter
reconciliation, bounded FirstMate status and checkpoints, deduplicated hook
ingestion with an atomic offline spool, and persisted one-shot timers that
atomically create ordinary mailbox messages. The daemon-restart integration
test interrupts a live message lease and completes it once after restart.

The real integration test registers three projects through the CLI, adopts a
fixture session from an isolated tmux server, restarts the daemon, and proves
that project and event JSON are identical after restart. TypeScript check and
the complete test suite pass.
The real tmux/OpenTUI smoke passes resize, Unicode, keyboard navigation, Home →
Event Journal → Home, live Fleet updates without a TUI restart, starting a
stopped FirstMate from its project view, and alternate-screen cleanup. The
daemon integration test starts a stopped project again the way `s` does and
proves the supervisor rebuilds its tmux session from durable state alone and
that the project then opens as a Home tab that did not exist before.

Panda explicitly authorized Claude Code, Claude Agent SDK, and model
integration on 2026-07-26 and asked that the project be carried through the
complete Definition of Done. Lifecycle, durability, and navigation must remain
deterministic and model-free; Claude is allowed only behind the documented
brain and FirstMate adapter boundaries. The graceful action still does not
launch another model: it delivers a bounded operator instruction to an already
running FirstMate.

### Next implementation slice

Continue with **Phase 3 — hooks, mailbox, status, checkpoints, and timers**:

1. add the bounded domain contracts and durable SQLite projections;
2. implement the fast hook/event client with an offline spool;
3. implement message leasing, acknowledgement, application, resolution, retry,
   and dead letters;
4. persist bounded FirstMate status/checkpoints and timer schedules;
5. prove daemon/TUI restart during delivery does not duplicate application.

The first five items now have a tested vertical slice. Finish Phase 3 with real
Claude hook fixtures/configuration, daemon-driven spool replay, safe urgent
interruption, and a fake FirstMate consuming `@pandamate/firstmate-kit`
end-to-end before beginning memory materialization.

Lifecycle remains deterministic and model-free. Every behavioral change must
update this README, the affected specification, and
[architecture decisions](docs/08-decisions.md).

### Live local state at the last verification

This is observational and may drift; recheck it before acting:

| Session | Role | Last observed |
|---|---|---|
| `pandamate:home` | Pandamate control deck | attached in `/dev/ttys012` |
| `firstmate` | adopted FirstMate candidate | attached in `/dev/ttys014` |
| `pandamate:idle-probe` | 24-hour TUI probe | detached; excluded from Fleet |

Treat existing tmux sessions as user state. Never kill `firstmate`
during development tests. Use isolated `tmux -L` servers and fake fixtures.

### Authoritative reading order

1. This README for current state and next action.
2. [Phase 1 progress](docs/12-phase-1-progress.md) for implemented evidence.
3. [Implementation roadmap](docs/06-implementation-roadmap.md) for phase scope.
4. [State and protocols](docs/03-state-and-protocols.md) for invariants.
5. [Architecture decisions](docs/08-decisions.md) for accepted behavior.
6. [Testing and acceptance](docs/07-testing-and-acceptance.md) before handoff.

## Development

The toolchain is pinned by `.nvmrc` and the pnpm lockfile. Always enter it with
`nvm use`; do not rely on the shell's default Node:

```bash
nvm use
pnpm install --registry=https://registry.npmjs.org
pnpm check
pnpm test
pnpm pandamate daemon start
pnpm pandamate status
pnpm pandamate events
pnpm spike:tui
pnpm spike:tui:discovered
pnpm spike:tmux
pnpm spike:tmux:tui
pnpm spike:tmux:navigation
```

If pnpm is missing after `nvm use`, install/activate pnpm 8.15.8 for the selected
Node. If the configured Yandex npm registry stalls or lacks a tarball, use
`pnpm install --registry=https://registry.npmjs.org`.

`spike:tui` uses Node's experimental FFI support. Socket integration tests need
permission to create temporary local Unix sockets. `spike:tmux` uses a private
tmux server and does not touch normal tmux sessions.

`spike:tui:discovered` must run inside tmux. It validates and displays existing
non-control tmux sessions in the Fleet. Sessions named `pandamate:*` are
control-plane surfaces and stay out of the project Fleet.

In the discovered Fleet, `Enter` opens a Project view, `o` opens that tmux
session in a new iTerm window while Pandamate stays visible, `x` opens an
explicit stop-session confirmation, and `s` starts a registered project whose
runtime has stopped. All active shortcuts are shown in the contextual footer.
From Home, `e` opens the separate durable Event Journal.

The deterministic CLI currently supports:

```bash
pnpm pandamate daemon start
pnpm pandamate project add mandala Mandala git /absolute/workspace
pnpm pandamate project create FirstMateGit /absolute/workspace
pnpm pandamate project adopt mandala existing-tmux-session
pnpm pandamate status
pnpm pandamate start mandala
pnpm pandamate events
pnpm pandamate daemon stop
```

Operational state defaults to
`~/Library/Application Support/Pandamate`; the Unix socket and instance lock use
a short private directory under the local temporary directory. Tests override
both locations and never write live state into this synchronized checkout.

## Repository map

```text
apps/cli                 deterministic user-facing CLI
apps/daemon              single-writer daemon and Unix-socket server
packages/client          bounded local protocol client
packages/config          state/runtime path validation
packages/domain          project/event contracts and validation
packages/protocol        versioned request/response frames
packages/storage         SQLite migrations, projections, and event log
packages/runtime-tmux    validated tmux discovery, lifecycle, and iTerm adapter
spikes/tmux              real tmux, navigation, TUI, and idle smokes
spikes/tui               current OpenTUI control deck
docs                     product specification and evidence logs
```

## Specification index

1. [Product and scope](docs/01-product-and-scope.md)
2. [Architecture](docs/02-architecture.md)
3. [State, events, and protocols](docs/03-state-and-protocols.md)
4. [Memory and recovery](docs/04-memory-and-recovery.md)
5. [TUI and visual design](docs/05-tui-and-ux.md)
6. [Implementation roadmap](docs/06-implementation-roadmap.md)
7. [Testing and acceptance](docs/07-testing-and-acceptance.md)
8. [Architecture decisions](docs/08-decisions.md)
9. [Security and operations](docs/09-security-and-operations.md)
10. [Research references](docs/10-references.md)
11. [Phase 0 results](docs/11-phase-0-results.md)
12. [Phase 1 progress](docs/12-phase-1-progress.md)
13. [Phase 2 progress](docs/13-phase-2-progress.md)
14. [Completion audit](docs/14-completion-audit.md)
15. [Phase 3 progress](docs/15-phase-3-progress.md)
16. [FirstMate and gnhf topology](docs/16-firstmate-and-gnhf-topology.md)
17. [Full shutdown](docs/17-full-shutdown.md)
18. [Agent operating notes](docs/18-agent-operations.md)

## North-star invariant

> No accepted decision may exist only in a Claude conversation.

Pandamate acknowledges a durable decision only after it has been written to the
external system of record.
