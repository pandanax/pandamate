# 05. TUI and visual design

## 1. Experience goal

Pandamate should feel like a calm, living control deck rather than a log viewer.
It is information-dense but quiet, graphical within ordinary terminal
capabilities, and fully usable without leaving the keyboard.

Visual direction: **Panda Control Deck**.

- graphite background;
- soft white primary text;
- bamboo green for healthy activity;
- amber for waiting/attention;
- coral for failures or dangerous states;
- cyan/purple reserved for navigation and Pandamate intelligence;
- Unicode line art, blocks, braille/sparklines, and subtle animation.

## 2. Home screen

```text
╭─ 🐼 PANDAMATE ───────────────────────────────────── 14:42 ─╮
│ ALL SYSTEMS  ● 3 ACTIVE  ◉ 1 WAITING  ○ 2 SLEEPING         │
├──────────────────────────┬──────────────────────────────────┤
│ FLEET                    │ SELECTED: MANDALA                │
│ ● Mandala        working │ Fixing mobile authentication    │
│ ◉ ARC-1234       waiting │ ◌ ─ ◉ ─ ◌   iteration 18        │
│ ◌ Legal          sleeping│ ███████████░░░  78%              │
│ ○ Personal site  stopped │ heartbeat 4s ago                 │
├──────────────────────────┼──────────────────────────────────┤
│ LIVE ACTIVITY            │ ATTENTION                        │
│ 14:41 tests completed    │ ARC-1234 needs a decision       │
│ 14:40 instruction routed │ [Review] [Open FirstMate]       │
├──────────────────────────┴──────────────────────────────────┤
│ › ask Pandamate anything…                                  │
╰─────────────────────────────────────────────────────────────╯
```

Home answers four questions without AI:

1. What is running?
2. What is each FirstMate doing?
3. What changed recently?
4. Where is Panda needed?

The Fleet contains only supervised FirstMates and adopted project sessions.
Pandamate control-plane sessions such as `pandamate:home`,
`pandamate:write`, probes, and future `pandamate:service-*` runtimes are shown
in the separate Pandamate Services projection and never as Fleet projects.

## 3. Screens

### Home

Fleet, selected summary, curated activity, Pandamate Services, and Pandamate
input. `s` opens the dedicated services screen; `i` opens the writing surface.

### Pandamate Services

Operational tmux surfaces owned by Pandamate itself, including Home, Write,
probes, and service runtimes. This is control-plane visibility, not a list of
FirstMates, and service rows do not expose project lifecycle actions.

### Project

Lifecycle, current goal, progress, current/previous session, heartbeat, pending
messages, checkpoints, contextual actions, and “open tmux”.

### Conversation

Threaded Panda → Pandamate → FirstMate communication. Each instruction expands
to show routing, acknowledgement, application, and result.

### Timeline

Filterable global event stream with quiet/default, detailed, and raw modes. It
is a first-class destination named **Event Journal**, reachable directly from
Home with `e`; it is not nested under a project.

### Memory

Active decisions, recently changed memories, freshness indicators, conflicts,
source event, and “show superseded history”.

### Sessions

tmux targets, PIDs, Claude session IDs, context generation, runtime health, and
recovery controls.

### Diagnostics

Daemon health, database/WAL, hook delivery, spool size, timer backlog, tmux
version, Claude connectivity, and TUI capabilities.

## 4. Interaction model

Global:

| Input | Action |
|---|---|
| `↑/↓` or `j/k` | move selection |
| `Enter` | open selected item |
| `e` | open the global Event Journal from Home |
| `Esc` | back/close overlay |
| `/` | command palette |
| `:` | deterministic CLI command |
| `i` | focus Pandamate input |
| `o` | open selected tmux session in a new iTerm window |
| `s` | start the selected FirstMate again after it stopped |
| `g` | ask selected FirstMate to shut down gracefully |
| `r` | reset selected FirstMate: graceful stop, then deploy again |
| `m` | message selected FirstMate |
| `l` | project timeline |
| `?` | contextual help |
| `X` | close all of Pandamate, gracefully |
| `q` | close TUI, leave daemon/agents running |

Mouse selection and scrolling are supported but never required.
Every currently available keyboard action is rendered in the contextual footer;
the user does not need to remember an undisclosed required shortcut.

The Home Live Activity panel contains an explicit `[e] Open event journal`
entry. The Event Journal is a separate full-screen view ordered by durable event
sequence. `↑/↓` or `j/k` moves through entries and `Esc` returns to Home.

`i` opens the dedicated **Write to Pandamate** surface. It accepts ordinary
keyboard input and bracketed paste, so dragging a folder from Finder inserts
its absolute path. The first deterministic skill is project onboarding:

```text
Создай проект FirstMateGit "/absolute/path"
Подними /absolute/arcadia/path как FirstMateArc
Создай DocResearch "/absolute/research/path"
```

Enter submits; Esc cancels. A path-only submission is accepted when
`.claude/settings.json` contains a FirstMate marker and the workspace has an
unambiguous Arcadia or Git repository marker. A submitted `.claude` directory
is normalized to its parent workspace. Otherwise the profile must be named
explicitly. Registered Fleet rows and project details show the resolved public
profile; unadopted tmux candidates remain visibly unclassified.

For configured FirstMate workspaces, Selected uses
the newest liveness timestamp from `.firstmate/state/.last-watcher-beat` and
the active Claude transcript. If bounded Claude JSONL transcripts exist for
that exact workspace, the newest assistant text block becomes `last message`;
thoughts, tool calls, and other worktrees are ignored. A bounded `*.status`
line is the fallback. Selected shows profile, status, the live tmux window
count, heartbeat age, and that message; it does not invent a percentage
progress estimate. Missing optional evidence renders as `not reported yet` and
never falls back to a runtime summary or terminal scraping. Heartbeat age is
rendered as `HH:MM:SS`, including hours beyond 24.

On a Fleet item, `Enter` opens its Project view. The initial live-session
actions are:

- `o`: open the selected session in a new iTerm window while keeping Pandamate
  visible in its original window;
- `g`: after confirmation, type a bounded graceful-shutdown instruction into
  the active pane of tmux window `0`, where the main FirstMate normally lives;
- `r`: after confirmation, ask that same main FirstMate to gracefully dismiss
  its current crew and close owned resources, then deploy Watcher, workers, and
  service windows again without closing the main pane;
- `x`: request stopping the entire selected tmux session;
- `Esc`: return to the Fleet.

A stopped project has none of those: its tmux session is gone, and its Home tab
went with it, so `o` has nothing to reopen. Its single action is `s` — start
this FirstMate again and open its tab. It is not confirmed, because it creates
work rather than destroying it, and `x` undoes it. The request carries the
durable project slug instead of a session name, the daemon records the project
as wanted running, and the supervisor deploys session, FirstMate, and Watcher
on its next pass.

`s` then waits for that runtime and finishes the job the user actually asked
for: it opens the project's Home tab, exactly as `o` would, and names the tab to
switch to. So the action answers twice — first that the start was durably
accepted, with the row reporting `starting`, then that the FirstMate is up and
where it landed. Readiness is read from the daemon's recorded `tmuxTarget`
rather than from tmux directly, because a project keeps its session *name* long
after that session is gone; only a recorded target means Pandamate has seen this
runtime alive. Waiting is bounded at 30 seconds, after which the project stays
wanted running and the screen says to use `o` once it appears. A tab that cannot
be opened — home is not running, the session died in the same breath — is
reported as such and never turns a successful start into a failure.

A Fleet item Pandamate merely discovered has no durable slug and says so rather
than pretending it can be started. The project footer shows only the actions
that item can actually perform now, so a stopped FirstMate offers `s` and never
`o`, `g`, `r`, or `x`. See
[D-029](08-decisions.md#d-029--a-stopped-firstmate-is-started-again-by-slug-from-the-fleet).

Graceful shutdown and immediate stopping each open a separate confirmation
surface naming the exact target. Graceful shutdown asks the FirstMate to
checkpoint, dismiss its workers, close project resources and connections,
safely unmount Arcadia when applicable, and close its own tmux session last.
The Fleet item remains as an inactive FirstMate after that runtime disappears;
Fleet identity is durable project state, not a projection containing only live
tmux sessions. Reset has its own confirmation and combines graceful crew
shutdown with a fresh deployment while keeping the main control pane alive.
Immediate stop states that every window and pane will terminate at once. Only
`y` executes either action; `n` or `Esc` cancels it.

`X` is the fleet-wide counterpart, and the only action that ends Pandamate
itself. Its confirmation names how many live FirstMates and services will close,
spells out the three stages in order, and states that tmux sessions outside the
`firstmate-*` and `pandamate:*` namespaces are left alone. Confirming replaces
the screen with live shutdown progress: the four stages, and one line per
session showing whether it closed itself, was forced, or could not be reached.
That screen is fed by the host over IPC rather than by the daemon projection,
because the daemon is stopped halfway through the sequence it describes. Keys
are ignored while it runs — the window is closed as the final step — except
after a failure, which hands the keyboard back so `Esc` returns Home. Full
record: [17-full-shutdown.md](17-full-shutdown.md).

The command palette combines deterministic commands and natural language:

```text
Open Mandala
Message ARC-1234
Restart Legal
Show projects needing attention
Summarize today
```

Commands that do not require semantics bypass Claude.

## 5. tmux navigation

`open` creates a separate iTerm window and attaches a new tmux client to the
FirstMate target. The Pandamate client stays attached to `pandamate:home`, so
the control deck remains available without a return shortcut. Closing the new
terminal window detaches that client but does not stop the FirstMate session.

The terminal-opening adapter is isolated from tmux discovery and lifecycle
control so another supported terminal path can be added without changing the
TUI protocol.

Direct FirstMate mode displays a small tmux status segment:

```text
PANDAMATE ← return | Mandala | working | heartbeat 4s
```

## 6. Animation

Allowed:

- heartbeat pulse;
- launch/recovery step animation;
- state-transition interpolation;
- progress bars and low-frequency sparklines;
- brief highlight of new activity;
- non-blocking notification badge.

Rules:

- animation communicates change;
- default tick is low frequency and pauses when unfocused;
- no full-screen redraw storm;
- idle CPU target below 2%;
- `reduced_motion=true` disables non-essential animation;
- errors never rely only on color or motion.

## 7. Responsive layouts

- **Wide (≥120 columns):** fleet, detail, activity, attention in one view.
- **Standard (80–119):** fleet/detail split with tabbed lower panel.
- **Compact (<80):** one panel at a time and persistent status header.
- **Non-interactive:** plain text or JSON from CLI; no escape sequences.

Support true color, 256-color fallback, `NO_COLOR`, high contrast, and terminal
resize without loss of input.

## 8. Rendering and data rules

- TUI never reads SQLite, tmux, or Markdown directly.
- All views are daemon projections.
- Event subscription resumes from a sequence cursor after reconnect.
- Optimistic UI is allowed only for reversible navigation, not lifecycle state.
- Long text is wrapped/truncated with an explicit expand action.
- Raw transcripts require deliberate navigation and are never streamed home.

## 9. Visual-design deliverables

Before production UI implementation:

1. static mockups for every screen in wide/standard/compact sizes;
2. palette and typography/character sheet;
3. interaction prototype with fake events;
4. animation timing sheet;
5. terminal compatibility matrix;
6. user review and one dedicated visual-polish iteration.

Visual polish is a milestone, not end-of-project cleanup.
