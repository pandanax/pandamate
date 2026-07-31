# tmux spike

Reusable tmux discovery, validation, lifecycle primitives, registered-project
Home tabs, iTerm fallback, Watcher deployment, and fleet shutdown live in
`packages/runtime-tmux`. This directory contains real-environment smokes plus
the current launcher/controller that joins daemon projections, bounded tmux
evidence, the Agent SDK brain, and the OpenTUI child.

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
