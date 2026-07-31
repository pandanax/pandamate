# 11. Phase 0 results

This is the evidence log for technical spikes, updated with subsequent evidence
through 2026-07-31. A passing row is evidence, not automatic acceptance of a
proposed architecture decision.

## Environment

| Item | Observed |
|---|---|
| Host | macOS 15.7.4, Apple Silicon |
| Node.js | 26.5.0 via `nvm use` |
| npm | 11.17.0 |
| pnpm | 8.15.8 |
| tmux | 3.7b |
| OpenTUI | 0.4.5 |

Node 26.5.0 is pinned in `.nvmrc`. It is a Current release at the time of this
spike. The production Node LTS choice remains open.

## TUI spike

Location: `spikes/tui`.

Implemented:

- real OpenTUI native renderer under Node experimental FFI;
- wide, standard, and compact layouts at 120/80-column breakpoints;
- keyboard and mouse project selection;
- Unicode control deck and true-color palette;
- low-frequency heartbeat pulse and reduced-motion mode;
- resize response, debug overlay, and explicit cleanup;
- validated project injection from live tmux discovery;
- Fleet-to-Project navigation with contextual hotkey help;
- IPC-routed `open tmux` and confirmed `stop session` actions, keeping direct
  tmux access outside the TUI;
- pure unit tests for layout, selection, progress, motion, Fleet children,
  projected data, and the TUI control protocol;
- daemon-backed Home, Services, Project, Event Journal, input/rename, lifecycle
  confirmation, and shutdown-progress surfaces.

Verified:

- TypeScript check passes;
- 19 TUI unit tests pass;
- native renderer starts in a PTY;
- `q` destroys the renderer and restores the terminal;
- OpenTUI 0.4.5 works on Node 26.5.0.
- real tmux smoke passes for wide/compact resize, Unicode, keyboard selection,
  top-level Event Journal navigation, and alternate-screen cleanup;
- a 15-second idle probe averaged 1.99% CPU, peaked at 4.00% CPU, and grew from
  111.5 MiB to 124.9 MiB RSS during startup/warm-up;
- a 24-hour probe command and isolated service shape exist; the final 24-hour
  result is not recorded in this repository.

Not yet verified:

- real mouse events and OSC 52 clipboard behavior;
- forced-crash alternate-screen restoration;
- true-color/256-color/`NO_COLOR` matrix;
- bounded memory during a completed 24-hour idle run;
- packaging without a development checkout.

## tmux spike

Location: `spikes/tmux`.

Implemented:

- strict project-slug validation;
- stable project target names (originally `pandamate:<project-slug>`, superseded
  by `firstmate-<project-slug>`);
- exact origin target parsing for return navigation;
- stable session-ID resolution for names containing tmux target delimiters;
- argument-array execution through `execFileSync`;
- isolated `tmux -L` smoke server with guaranteed cleanup.
- discovery of already running sessions without modifying their processes.

Verified:

- seven tmux unit tests pass;
- two isolated sessions can be created and discovered;
- session names retain the `pandamate:` namespace;
- the private test server is cleaned up without touching normal sessions.
- a real attached client switches from `pandamate:home` to
  the Mandala project session and returns to the exact
  `$session:@window.%pane` origin;
- existing `firstmate` and `gnhf` sessions appear as `running` in the Fleet,
  while `pandamate:home` is correctly excluded as control-plane state.
- `Enter` opens a real discovered Project view; its stop confirmation was
  exercised and cancelled without modifying `gnhf`;
- the original `o` smoke opened a live session in a separate iTerm window;
  D-034 later superseded that path for registered projects with linked Home
  tabs, while preserving iTerm as the unregistered-session fallback;
- linked-tab open/reopen/close, automatic teardown, status hints, stopped-project
  restart-and-open, and full fleet shutdown now have unit/integration evidence.

Not yet verified:

- terminal adapters other than iTerm;
- recovery after a pane or server is killed.

## Claude Agent SDK spike

Panda authorized Claude Code and Agent SDK integration on 2026-07-26. The
implemented `packages/agent-sdk` spike proves:

- a bounded JSON briefing over projects, decisions, unresolved messages, and
  recent events;
- streamed partial text and result handling through a recorded query fixture;
- resumable session ID retention, explicit close/cancel, 45-second timeout, and
  rotation after a bounded turn count;
- no tools and `permissionMode: dontAsk`, keeping lifecycle and persistence out
  of model control;
- live use by the TUI launcher for non-onboarding text.

Not yet measured or accepted:

- real cancellation from the TUI and forced stream interruption;
- real authentication/network/offline matrix and latency/cost telemetry;
- hook latency with recorded Claude Code hook payloads;
- validated brain tools and durable conversation/session projections.
