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
- **Status:** accepted historically; public Docs naming was superseded by
  D-022's `DocResearch` name while retaining `FirstMateDocs` as an input alias.

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
- **Status:** superseded for registered projects by D-034. The separate-iTerm
  adapter remains the fallback for unregistered discovered sessions.

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
- **Starting includes the tab.** A FirstMate nobody can see is not back, so the
  action does not end at the request: the host waits for the runtime and then
  opens the project's Home tab through the same `project.open` path as `o`.
  Readiness is the daemon's recorded `tmuxTarget`, not the presence of a session
  name — a project keeps its session name long after that session is gone.
  Waiting is bounded at 30 seconds; expiring leaves the project wanted running
  and hands the user back to `o`. Because the runtime does not exist when the
  key is pressed, one request answers twice — accepted, then opened — and a
  tab that cannot be opened is reported without demoting a start that worked.
- **Excluded on purpose:** starting is not confirmed like `g`, `r`, and `x`.
  Those destroy running work; this creates it and is undone by `x`. A Fleet item
  Pandamate only discovered has no slug and stays unstartable — Pandamate does
  not know how to build a session it never created.
- **Status:** accepted.

### D-030 — DocResearch launches as a light research partner, not a FirstMate

- **Decision:** The launch prompt is profile-aware. `firstMateProfileForProject`
  now also returns `supervises` — `true` for the code profiles (`FirstMateArc`,
  `FirstMateGit`), `false` for `DocResearch` — and `launchCommand` frames the
  role from it. Supervising profiles keep their exact wording: "the main
  FirstMate", their per-kind instructions, and the tail that tells them to own
  durable state, supervise workers, and report checkpoints. DocResearch instead
  opens as "a research partner (DocResearch)" whose first act is to ask the
  captain focused clarifying questions about the research goal, scope, sources,
  and desired deliverable before doing any work, then runs a lightweight,
  conversational session that captures durable findings as written notes. Its
  runtime line also drops the "FirstMate ... role" framing and states plainly
  that there is no crew, worktree, or pull-request machinery to run — the product
  is documents (research notes, a filled wiki, written reports), not pull
  requests, and it neither dispatches workers nor opens worktrees.
- **Reason:** A research workspace given the heavy supervisor framing was told
  to own durable work, dispatch workers, and report checkpoints, so the launched
  agent did not know what to do and reported confusion to the captain. The
  research partner is a conversation that produces notes, not a code-shipping
  orchestrator, and its opening prompt should reflect that.
- **Unchanged:** only the role framing differs. Every profile keeps the shared
  identity header (workspace path, runtime/executable, tmux session — these feed
  heartbeat and lifecycle) and the final safety line "Never operate on unrelated
  projects or pandamate:* control-plane sessions." DocResearch is still the
  long-running main process for its project; tmux, heartbeat, Watcher, and
  supervision are untouched.
- **Status:** accepted.

### D-031 — An arc FirstMate resolves its Watcher from its firstmate home, derived from the arc root

- **Decision:** Watcher resolution ([D-028](#d-028--the-watcher-is-deployed-by-the-control-plane-not-by-the-firstmate))
  searches the workspace first and, only if the workspace declares none, the arc
  FirstMate's firstmate home. An arc FirstMate's workspace is product code (e.g.
  monomarket at `~/arcadia/market/front/monomarket`) that carries no watcher of
  its own; its `fm-watch` lives in the arc FirstMate's separate crew-tooling home
  (`~/arcadia/junk/pandanax/firstmate/bin/fm-watch`), entirely outside the
  workspace, so the pure workspace-relative lookup returned `null` and the
  `watch` window was never deployed — nothing reaped finished crew worktrees.
  That home is now **known without configuration**: `arcFirstMateHome(workspace)`
  walks up to the workspace's `.arc` mount root and returns
  `<arcRoot>/junk/pandanax/firstmate`, so the fix works wherever arcadia is
  mounted with no env to set. `workspaceWatcherCommand` takes optional
  `fallbackRoots`, and the supervisor passes the derived home as one fallback
  root **only for `kind: "arc"` projects**. `PANDAMATE_FIRSTMATE_HOME` remains an
  optional override that takes precedence, for when the topology moves. The same
  three candidates (`.pandamate/watch`, `firstmate/bin/fm-watch`, `bin/fm-watch`)
  and the same executable-regular-file and shell-safe-path checks apply under
  each root.
- **Reason:** the design gap in D-028 was that Watcher resolution assumed the
  watcher lives under the workspace. That holds for a git project whose
  workspace *is* the repository, but not for an arc FirstMate driving product
  code from a separate crew-tooling home. Requiring an env var to bridge the gap
  would have left the fix inert until someone set it; deriving the home from the
  arc root makes it self-configuring.
- **No regression to D-028 or git projects:** the workspace search runs first and
  unchanged, so any project that declares its own watcher (git projects like
  pandamate/mandala, or any workspace with `.pandamate/watch`) resolves exactly
  as before and never reaches the fallback. The fallback is gated to `kind:
  "arc"`, so a git project without a watcher never inherits the arc one; an arc
  workspace outside any `.arc` root (or with the tooling absent) derives nothing
  and degrades to today's behaviour rather than failing. The arm-and-wake watcher
  shape and adopted sessions remain untouched. The `watch` window still runs with
  the product workspace as its working directory and `PANDAMATE_TMUX_SESSION`
  set, which is what the crew tooling's `crew-retire` needs.
- **Status:** accepted.

### D-033 — Code work is isolated in a worktree; landing is per-VCS

- **Decision:** Every supervising FirstMate's launch prompt (`supervisor.ts`, the
  `supervises` role) carries a standing rule: any task that changes code runs in
  its own isolated worktree on its own branch, never edited directly in the shared
  checkout, and the FirstMate prefers dispatching a worker into that worktree over
  doing code work in its own session. **Isolation is universal; landing is the
  home's call and differs by VCS** — a **git** FirstMate pushes to `main` directly
  (and deploys per the project's settings); an **arc** FirstMate opens a PR and
  watches CI, and never merges or deploys (the captain merges). Once Panda has
  allowed pushing to main, a git FirstMate pushes without asking again; when the
  landing mode is genuinely unclear, it asks «push or PR?» rather than guessing.
  See [docs/18](18-agent-operations.md) and the capability matrix in
  [docs/19](19-firstmate-responsibilities.md).
- **Reason:** Panda's directives (2026-07-28): «все фестмэйты которые что-то делают
  в коде должны создать ветку … в изолированном воркспейсе», then «все кроме арк —
  смело пуш в мэйны, а арк создавай пр-ы». Un-isolated code work piles onto
  whatever branch is checked out (the arc main mount is often on someone else's
  product branch; the pandamate git tree is shared by parallel sessions), so
  isolation is enforced for everyone in the launch prompt. But landing ceremony is
  a VCS-specific "how" that belongs to each home: git is low-ceremony (straight to
  main), arc goes through Arcanum review + CI.
- **Scope:** the `supervises` profiles (FirstMateArc, FirstMateGit) only.
  DocResearch is not a code-shipping FirstMate — its prompt keeps the light
  research framing ([D-030](#d-030--docresearch-launches-as-a-light-research-partner-not-a-firstmate))
  and does not carry this rule.
- **Status:** accepted.

### D-035 — Git changes land through required CI and project-owned merge mode

- **Decision:** The git landing portion of D-033 is superseded. A git FirstMate
  pushes an isolated branch, opens a PR or merge request, and watches the
  required checks. Merge authority is the durable project's `mergeMode`, never
  a property or preference of FirstMate: `auto` enables the forge's native
  auto-merge; `manual` waits for Panda after CI. The protected default branch
  rejects direct pushes in either mode. Arc keeps its existing Arcanum path:
  open a PR, watch CI, and leave the actual merge to the captain.
- **Local documentation gate:** Pandamate installs a tracked pre-commit hook from
  `.githooks`. It loads the version pinned by `.nvmrc` with `nvm use`, then runs
  `pnpm docs:generate`; when output changes, the commit stops for review and
  explicit staging. CI independently runs `pnpm docs:check` from a clean
  checkout, so generated drift cannot enter the protected branch.
- **Reason:** Direct-to-main CI reports failure only after the broken revision is
  already the default branch. Required checks plus native auto-merge turn the
  same verification into a real admission gate. Generating locally removes the
  easy-to-forget manual step without silently adding files to a commit.
- **Status:** accepted by Panda on 2026-08-01; implemented for Pandamate beginning
  with the PR that introduced this decision.

### D-034 — Registered FirstMates open as tabs of Pandamate Home

- **Decision:** Opening a registered running project links window `0` of its
  independent `firstmate-<slug>` session into `pandamate:home`, selects the
  linked window, and exposes tmux window-number navigation. The FirstMate keeps
  running in its own durable session. Closing the tab unlinks it; it must never
  call `kill-window`, which would destroy the shared window in both sessions.
- **Lifecycle:** stop, restart, heartbeat recovery, and full shutdown detach a
  linked tab before killing a project session. Starting a stopped FirstMate
  waits for the supervisor to observe the rebuilt runtime and then opens the
  returned tab without treating tab-open failure as start failure.
- **Fallback:** a merely discovered, unregistered session has no durable slug,
  so D-016's separate-iTerm adapter remains available for it.
- **Evidence:** `openSessionAsControlTab`, `closeControlTab`, stable session-ID
  tests, daemon `project.open`/`project.tab.close`, automatic supervisor detach,
  and the start-again integration smoke.
- **Status:** accepted; implemented beginning with commit `cf71448` and extended
  through the full tab lifecycle.

### D-032 — A crew session renders as children under its project, not as itself

- **Decision:** A discovered non-control tmux session that only hosts another
  project's crew is folded into that project's Fleet row, and its hosted
  crewmates are rendered as **indented child rows under that project**, instead
  of appearing as a separate, nameless top-level Fleet item. A FirstMate names
  its crew windows `fm-<slug>-<task>`; when every crew window of a discovered
  session resolves to one registered project slug — and the session is not itself
  a `firstmate-<slug>` project session — that session is the project's crew host.
  Its crew windows are carried onto the owning project's summary as a bounded
  `crew: { name; window }[]` (one crewmate per crew window, the task suffix as
  the display name) and the Fleet draws them beneath the project as `└─ <task>`
  children. The canonical case is the bare session literally named `firstmate`
  whose window `fm-mandala-numerology-aspect` is a mandala crewmate: with mandala
  registered it no longer shows up as a nameless FirstMate; instead mandala's own
  row visibly hosts a child `└─ numerology-aspect`.
- **How it is decided:** deterministically, from evidence already in tmux.
  Discovery (`discoverTmuxSessions`) now also collects each session's window
  names; `crewProjectSlug` reads the parent slug from one `fm-<slug>-<task>`
  window (the task suffix is required, and the slug is the longest registered
  prefix so hyphenated tasks like `numerology-aspect` still attribute to
  `mandala`); `crewHostProjectSlug` attributes a whole session only when all its
  crew windows agree on one registered slug, and `crewOfHostedSession` projects
  those windows into the bounded crew list. No model turn and no new tmux
  environment variable are involved — the naming convention the crew lifecycle
  already uses is the whole signal.
- **Why children, not hidden:** the crew session is real work, so folding it
  away entirely would make a running crewmate vanish from the operator's view.
  Drawing it as a child keeps the crewmate visible while attributing it to the
  project that owns it, so the Fleet reads as "mandala, hosting
  numerology-aspect" rather than "mandala" plus a mystery FirstMate. Children are
  display-only rows at the model's current altitude — keyboard navigation still
  selects project rows.
- **Excluded on purpose:** a session hosting crewmates of two different
  registered projects is ambiguous and stays its own Fleet item rather than
  being folded into one of them. A crew session for a project that is not
  registered is also left visible — there is no parent row to fold it into, and
  hiding it would make live work vanish. A registered project's own
  `firstmate-<slug>` session is never treated as a crew host; it is the
  FirstMate itself, attributed by its session name.
- **Scope:** the attribution and child rendering live in the discovered Fleet
  projection (`spike:tui:discovered`) and the TUI. The daemon projection and CLI
  `status` do not yet carry hosted crew; extending them is a separate decision.
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
- **Remaining gate:** mouse/clipboard verification, forced-crash restoration,
  completed 24-hour memory behavior, production packaging acceptance, and the
  terminal/color compatibility matrix. Real tmux resize, Unicode, keyboard,
  navigation, live projection refresh, and normal cleanup are proven.

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
