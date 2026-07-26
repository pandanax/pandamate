# 11. Phase 0 results

This is the evidence log for technical spikes. A passing row is evidence, not
automatic acceptance of a proposed architecture decision.

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
- pure unit tests for layout, selection, progress, and motion behavior.

Verified:

- TypeScript check passes;
- eight TUI unit tests pass;
- native renderer starts in a PTY;
- `q` destroys the renderer and restores the terminal;
- OpenTUI 0.4.5 works on Node 26.5.0.
- real tmux smoke passes for wide/compact resize, Unicode, keyboard selection,
  top-level Event Journal navigation, and alternate-screen cleanup;
- a 15-second idle probe averaged 1.99% CPU, peaked at 4.00% CPU, and grew from
  111.5 MiB to 124.9 MiB RSS during startup/warm-up;
- a 24-hour probe is running in `pandamate:idle-probe`.

Not yet verified:

- real mouse events and OSC 52 clipboard behavior;
- forced-crash alternate-screen restoration;
- true-color/256-color/`NO_COLOR` matrix;
- bounded memory during a 24-hour idle run;
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
- `o` was exercised through the TUI IPC controller and opened the live
  `firstmate` session in a separate iTerm window;
- two tmux clients coexist: one remains attached to `pandamate:home`, while the
  new window is attached to `firstmate`.

Not yet verified:

- terminal adapters other than iTerm;
- recovery after a pane or server is killed.

## Claude Agent SDK spike

Not started. Panda explicitly requested that Claude Code not be launched until
separate permission is given.
