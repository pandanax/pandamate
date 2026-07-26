# tmux spike

Reusable tmux discovery, validation, lifecycle primitives, and iTerm opening
live in `packages/runtime-tmux`. This directory contains only real-environment
smokes and the demonstration-specific TUI projection.

The smoke test creates two detached sessions on a private tmux server, verifies
their stable names, and cleans them up:

```bash
pnpm --filter @pandamate/spike-tmux smoke
```

The private `-L` socket keeps the automated spike separate from real tmux
sessions. Interactive client switching and exact return-to-origin must still be
run from a real PTY:

```bash
pnpm spike:tmux:tui
pnpm spike:tmux:navigation
```

Run the TUI with a validated snapshot of existing sessions:

```bash
pnpm spike:tui:discovered
```

Short and 24-hour idle probes:

```bash
pnpm spike:tui:idle -- --quick
pnpm spike:tui:idle -- --24h
```
