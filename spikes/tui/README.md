# OpenTUI spike

This directory contains the current OpenTUI child used by the live launcher. It
began as the non-AI Phase 0 spike and now renders:

- wide, standard, and compact layouts at the documented breakpoints;
- keyboard and mouse project selection;
- Unicode and the proposed Panda Control Deck palette;
- low-frequency heartbeat animation;
- reduced-motion mode;
- resize handling, debug overlay, and terminal cleanup.
- validated project/service/event projections from the launcher;
- Home, Services, Project, Event Journal, Pandamate input, project rename,
  lifecycle confirmations, and full-shutdown progress.

OpenTUI's native renderer currently requires Node.js 26.4+ with experimental
FFI (or Bun). This repository pins Node.js 26.5.0 for the spike.

```bash
nvm use
pnpm install
pnpm spike:tui
```

Set `PANDAMATE_REDUCED_MOTION=1` to start without non-essential animation.
The launcher in `spikes/tmux/src/launch-tui.ts` owns daemon polling, bounded
workspace/tmux evidence, Agent SDK conversation, lifecycle actions, and process
IPC. The child never reads SQLite or runs tmux directly.

The completed 24-hour result, clipboard, forced-crash restoration, and terminal
compatibility checks remain open Phase 0 measurements. Promotion into an
`apps/tui` production package remains Phase 6 work.
