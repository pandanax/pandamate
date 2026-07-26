# Pandamate macOS launcher

`Pandamate Launcher.app` is the personal macOS entry point:

1. enter the pinned Node toolchain and idempotently ensure the daemon is alive;
2. refresh `pandamate:home` onto the current checkout;
3. ensure the `pandamate:write` service and place it on the compose screen;
4. preserve a running `pandamate:idle-probe`, or start a new 24-hour probe when
   that service is absent;
5. open a new iTerm window and attach Home with tmux's absolute executable path.

Runtime diagnostics are written to `/private/tmp/pandamate-launcher.log`.
Rebuild the RGBA iconset with `make-icon.swift`, then package its modern PNG
chunks with `make-icns.ts`. The small local packer is used because the target
macOS `iconutil` rejects even an unmodified iconset extracted from a system
application.
