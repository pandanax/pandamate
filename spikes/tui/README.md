# OpenTUI spike

This spike validates the non-AI presentation surface from Phase 0:

- wide, standard, and compact layouts at the documented breakpoints;
- keyboard and mouse project selection;
- Unicode and the proposed Panda Control Deck palette;
- low-frequency heartbeat animation;
- reduced-motion mode;
- resize handling, debug overlay, and terminal cleanup.
- validated injection of discovered tmux sessions.

OpenTUI's native renderer currently requires Node.js 26.4+ with experimental
FFI (or Bun). This repository pins Node.js 26.5.0 for the spike.

```bash
nvm use
pnpm install
pnpm spike:tui
```

Set `PANDAMATE_REDUCED_MOTION=1` to start without non-essential animation.
The long-run, clipboard, crash-restore, and terminal compatibility checks remain
open Phase 0 measurements.
