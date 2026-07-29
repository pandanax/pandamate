# Pandamate macOS launcher

`Pandamate Launcher.app` is the personal macOS entry point:

1. enter the pinned Node toolchain and idempotently ensure the daemon is alive;
2. refresh `pandamate:home` onto the current checkout;
3. ensure the `pandamate:write` service and place it on the compose screen;
4. preserve a running `pandamate:idle-probe`, or start a new 24-hour probe when
   that service is absent;
5. open a new iTerm window and attach Home with tmux's absolute executable path.

## Deploying

The bundle on the Desktop is a **copy**, so editing the launcher here changes
nothing until it is installed:

```bash
tools/macos/deploy.sh          # install into ~/Desktop/Pandamate.app
tools/macos/deploy.sh --check  # report drift only; exit 1 when stale
```

Deploy in the same breath as the fix. The `base_window` fix — which stopped the
launcher respawning the TUI into whichever FirstMate tab happened to be selected
— sat here undeployed for two days while the Desktop copy kept killing panes.

## Diagnostics

Runtime diagnostics are written to `/private/tmp/pandamate-launcher.log`, and the
TUI's own stderr to `/private/tmp/pandamate-tui.log` (truncated per launch). The
second file exists because a TUI that dies on startup takes its pane, and its
stack trace, with it — leaving "Home did not render in time" and nothing else.
When Home fails to come up the launcher now appends the pane and that stderr to
the main log before showing the dialog, so the alert points at a real cause.

## The icon

Rebuild the RGBA iconset with `make-icon.swift`, then package its modern PNG
chunks with `make-icns.ts`. The small local packer is used because the target
macOS `iconutil` rejects even an unmodified iconset extracted from a system
application.
