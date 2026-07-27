# 08. Architecture decisions

This file records decisions accepted during product discovery. Implementation
changes must update this file and the affected specification.

## Accepted

### D-001 — Product name

- **Decision:** The global orchestrator and home surface are named Pandamate.
- **Status:** accepted.

### D-002 — Control plane, not project executor

- **Decision:** Pandamate supervises FirstMates; each FirstMate owns its project
  details and workers.
- **Status:** accepted.

### D-003 — Single normal communication point

- **Decision:** Panda normally communicates only with Pandamate. Direct FirstMate
  tmux access is an explicit escape hatch.
- **Status:** accepted.

### D-004 — Terminal-native home screen

- **Decision:** The primary interface is a rich graphical TUI/CLI, not a web
  dashboard.
- **Status:** accepted.

### D-005 — Durable external truth

- **Decision:** Operational state and semantic memory live outside Claude
  context. No decision is acknowledged before durable persistence.
- **Status:** accepted.

### D-006 — Replaceable brain sessions

- **Decision:** Daemon, UI, and identity are continuous; Claude brain sessions
  are bounded and replaceable.
- **Status:** accepted.

### D-007 — Automatic safe recovery

- **Decision:** Previously running safe FirstMates restart automatically.
  Ambiguous or dangerous external operations reconcile or request approval.
- **Status:** accepted.

### D-008 — Local daemon and tmux

- **Decision:** A deterministic local daemon owns state and supervises one stable
  tmux target per FirstMate.
- **Status:** accepted.

### D-009 — Typed durable mailbox

- **Decision:** Instructions use a persisted lifecycle with acknowledgements.
  `tmux send-keys` is not the primary communication protocol.
- **Status:** accepted.

### D-010 — Append-only audit plus current projections

- **Decision:** History is immutable; active status and memory are derived
  current projections. Superseded rules do not stay active.
- **Status:** accepted.

### D-011 — Initial FirstMate profiles

- **Decision:** Initial profiles are FirstMateArc, FirstMateGit, and
  FirstMateDocs.
- **Status:** accepted.

### D-015 — Adopt existing tmux sessions

- **Decision:** Pandamate discovers already running non-control tmux sessions at
  startup and presents them as supervised candidates without restarting their
  processes. Its own `pandamate:*` control-plane sessions are excluded from the
  project Fleet and remain visible in Sessions and Diagnostics.
- **Phase 2 evidence:** the daemon validates a live candidate, resolves its
  stable session ID, and atomically associates it with one registered project.
  The association and audit event survive daemon restart while the candidate
  process continues uninterrupted.
- **Status:** accepted.

### D-016 — Open FirstMates in separate terminal windows

- **Decision:** Opening a FirstMate creates a new iTerm window with its own tmux
  client. Pandamate remains attached to `pandamate:home` in the original window
  instead of switching that client away from the control deck.
- **Status:** accepted.

### D-017 — Event Journal is a top-level Home destination

- **Decision:** The global durable event stream has its own Event Journal
  screen, entered directly from Home with the visible `e` action. It is not
  hidden inside a project detail view.
- **Status:** accepted.

### D-018 — One argument-array tmux runtime boundary

- **Decision:** reusable tmux discovery, target validation, lifecycle
  operations, and terminal opening live in `packages/runtime-tmux`. Callers pass
  explicit argument arrays through an injectable command runner; stable tmux
  IDs are resolved before attachment or destructive actions. Spikes and daemon
  code consume this boundary rather than invoking tmux independently.
- **Status:** accepted.

### D-019 — Graceful shutdown is a message to the main FirstMate

- **Decision:** Graceful shutdown does not launch another Claude process and
  does not kill tmux directly. After explicit confirmation, Pandamate resolves
  the active pane in window `0` of the selected FirstMate session, types one
  bounded shutdown instruction there, and presses Enter. The FirstMate owns
  checkpointing, dismissing workers, closing connections and project
  resources, safely unmounting Arcadia when applicable, and closing its own
  tmux session as the final step. Immediate `x` kill remains a distinct,
  separately confirmed fallback.
- **Status:** accepted.

### D-020 — Fleet identity survives shutdown; reset is an in-session cycle

- **Decision:** A FirstMate remains in the Fleet as inactive after graceful
  shutdown; the project identity is not deleted when its tmux runtime exits.
  Reset is a distinct confirmed action delivered to the main pane in window
  `0`: the FirstMate gracefully stops its current workers and resources, then
  redeploys Watcher and its service windows. The main pane and primary tmux
  session stay alive throughout Reset so the same FirstMate can complete both
  halves of the operation.
- **Status:** accepted.

### D-021 — Claude integration is authorized behind deterministic boundaries

- **Decision:** Panda authorized real Claude Code and Agent SDK integration on
  2026-07-26 and requested completion through the full Definition of Done.
  Models may power FirstMate work, semantic routing, summarization, and the
  Pandamate brain. They never own lifecycle reconciliation, persistence,
  target validation, authorization, or navigation; those remain deterministic
  and independently testable.
- **Status:** accepted.

### D-022 — Folder-first onboarding and public profile names

- **Decision:** `i` opens Pandamate input. A request containing one absolute
  folder and one explicit profile creates and starts a durable project.
  Public profiles are `FirstMateArc`, `FirstMateGit`, and `DocResearch`;
  `FirstMateDocs` remains an accepted compatibility alias for `DocResearch`.
  The daemon still persists the stable core kinds `arc`, `git`, and `docs`.
  A launched FirstMate is the main Claude Code process in the project workspace
  and `firstmate-<slug>` tmux session, not a separate hidden executable.
- **Status:** accepted.

### D-023 — One durable instruction path for humans, timers, and FirstMates

- **Decision:** Every project instruction is a SQLite-backed message with a
  bounded priority and explicit lifecycle. Human input and fired timers both
  create the same queued entity. FirstMates pull leased batches and explicitly
  report acknowledgement, application, resolution, or failure. Lease expiry,
  retries, and dead letters are deterministic daemon work; `tmux send-keys`
  remains only the operator fallback used by graceful/reset controls.
- **Status:** accepted.

### D-024 — Hooks are telemetry with a local offline spool

- **Decision:** Hook payloads are bounded, schema-validated, normalized into
  append-only events, and deduplicated by a stable hook ID. A fast local client
  writes an atomic user-private spool file when the daemon is unavailable and
  replays files in order when connectivity returns. Hook delivery never blocks
  FirstMate work.
- **Status:** accepted.

### D-025 — Deterministic FirstMate discovery and visible Fleet profiles

- **Decision:** A path-only onboarding request may infer a profile only from
  bounded local evidence: a FirstMate marker in `.claude/settings.json` plus an
  unambiguous Arcadia or Git repository marker. A `.claude` path resolves to its
  parent workspace. Durable Fleet projects display the resulting public
  profile; raw tmux candidates remain unclassified until registration or
  adoption establishes their identity.
- **Status:** accepted.

### D-027 — Project sessions do not expose the Pandamate control namespace

- **Decision:** FirstMate project runtimes use `firstmate-<slug>` tmux session
  names. The `pandamate:*` namespace is reserved for Pandamate control-plane
  surfaces. Project names contain no tmux target separator, so child processes
  can safely reuse the current session name. The supervisor migrates legacy
  `pandamate:<slug>` sessions in place through their stable tmux session ID.
- **Status:** accepted.

### D-026 — Reuse bounded FirstMate workspace evidence

- **Decision:** For a configured FirstMate workspace, the daemon may read the
  fixed local watcher beacon `.firstmate/state/.last-watcher-beat` and the last
  bounded line of the newest non-hidden `*.status` file. It may also read the
  newest assistant text block from Claude's structured JSONL transcript whose
  `cwd` exactly matches the workspace; thinking, tools, and other worktrees are
  excluded. The newest timestamp across the watcher beacon and matching
  transcript activity becomes the project heartbeat; assistant text becomes
  the latest message. Pandamate does not scrape terminal output.
- **Status:** accepted.

### D-028 — The Watcher is deployed by the control plane, not by the FirstMate

- **Decision:** A project that declares a supervisor loop gets it running
  beside its FirstMate without a model turn. The supervisor reads one bounded
  piece of workspace evidence — an executable `.pandamate/watch`,
  `firstmate/bin/fm-watch`, or `bin/fm-watch` — and deploys it as window
  `watch` of the project's own `firstmate-<slug>` session right after launch,
  then keeps it there: a Watcher whose window is gone is deployed again on a
  later pass, bounded by `watcherRestartBackoffMs` and five consecutive
  redeploys before the supervisor stops and logs why. The window is not wrapped
  in a keep-alive shell, because an idle shell would be indistinguishable from
  a healthy Watcher. Pandamate publishes the session name in the launch
  environment and in the session's own tmux environment as
  `PANDAMATE_TMUX_SESSION`, so the Watcher, the FirstMate, and any window the
  FirstMate opens later agree on one session.
- **Excluded on purpose:** the arm-and-wake watcher shape
  (`bin/fm-watch.sh` armed by the FirstMate's own Stop hook) blocks until one
  actionable wake and exits for its caller to classify. Deploying that as a
  detached window would discard every wake reason, so it keeps arming itself.
  Adopted sessions are also left alone; Pandamate furnishes only sessions it
  created itself.
- **Status:** accepted.

### D-029 — A stopped FirstMate is started again by slug, from the Fleet

- **Decision:** Durable Fleet identity ([D-020](#d-020--fleet-identity-survives-shutdown-reset-is-an-in-session-cycle))
  is actionable, not only visible. `s` in a project's view asks Pandamate to
  deploy that FirstMate again. Every other project action addresses a tmux
  session, which is exactly what a stopped project no longer has — its tab was
  destroyed with its session, so `o` cannot reach it either. The start request
  therefore travels by durable project slug (`project.start`), and the host
  answers it the same way onboarding does: the daemon records the project as
  wanted running and the supervisor rebuilds session, FirstMate, and Watcher on
  its next pass. Pandamate never launches the runtime from the TUI process
  itself, so one lifecycle owner remains.
- **Excluded on purpose:** starting is not confirmed like `g`, `r`, and `x`.
  Those destroy running work; this creates it and is undone by `x`. A Fleet item
  Pandamate only discovered has no slug and stays unstartable — Pandamate does
  not know how to build a session it never created.
- **Status:** accepted.

## Proposed; validate in Phase 0

### D-012 — TypeScript core

- **Proposal:** Use TypeScript/Node.js for daemon, CLI, protocol, and Claude Agent
  SDK integration.
- **Reason:** one language and direct use of the official SDK.
- **Validation:** long-run resource behavior and packaging.
- **Phase 0 evidence:** the workspace type-checks and tests on Node.js 26.5.0.
  Node 26.5 is pinned because the OpenTUI native renderer needs Node 26.4+ with
  experimental FFI. Node 26 is still a Current release, not LTS, so this does
  not yet accept the production core runtime decision.

### D-013 — OpenTUI

- **Proposal:** Use OpenTUI for the rich terminal interface.
- **Reason:** high-performance native renderer with TypeScript bindings and
  component APIs.
- **Fallback:** Ratatui client against the same daemon protocol.
- **Validation:** tmux compatibility, crash restoration, idle resources,
  packaging, and testability.
- **Phase 0 evidence:** OpenTUI 0.4.5 renders the responsive control-deck
  prototype on the target Mac under Node 26.5 experimental FFI, receives
  keyboard input, and restores the terminal after `q`. The older 0.1.x package
  line failed on Node because it published Bun-specific file imports.
- **Remaining gate:** real tmux interaction, mouse/clipboard verification,
  forced-crash restoration, idle CPU, 24-hour memory behavior, and packaging.

### D-014 — SQLite WAL

- **Proposal:** Use SQLite WAL as the sole operational database.
- **Validation:** crash tests, backup/restore, write latency, and migration
  behavior on the target filesystem.
- **Phase 1 evidence:** migrations, WAL mode, transactional project/event
  writes, idempotent command replay, bounded sequence queries, and identical
  projections across a real daemon restart are covered by automated tests.

## Deferred decisions

- exact package manager and monorepo tooling;
- launch-at-login mechanism and install layout;
- transcript retention period;
- default model and per-operation model routing;
- integration path for already running FirstMates;
- optional iTerm2 enhancements;
- remote control and synchronization.
