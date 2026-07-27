# 17. Closing all of Pandamate

Pandamate can start a fleet; it must also be able to put it away. This is the
record of what "close everything, gracefully" means, in what order, and why the
order is the whole design.

Implemented 2026-07-27.

## 1. What it does

One action — `X` on the Home screen, or `pandamate shutdown-all` — ends
everything Pandamate owns:

1. **Drain the daemon.** Supervision pauses and every project is durably marked
   `desiredState: stopped`.
2. **Close every FirstMate gracefully.** Each `firstmate-*` session is asked, in
   its own window 0, to run the standard graceful shutdown: save state and a
   checkpoint, dismiss the crew, end child sessions, servers and connections,
   unmount an Arcadia workspace if one is mounted, and close its own tmux
   session last of all.
3. **Wait, then force only what is left.** Pandamate polls for each session to
   disappear. Whatever is still up when the grace period ends has its home tab
   unlinked and its session stopped.
4. **Stop the daemon** and wait for the socket to go quiet.
5. **Close Pandamate's own windows**, `pandamate:home` last — which is where the
   process driving all this stops existing.

## 2. Why the order is not negotiable

**The drain has to come first.** The supervisor's whole job is to notice that a
FirstMate's session is missing and put it back. The last step of a graceful
shutdown is a FirstMate closing its own session. Without a drain, every
FirstMate that shut down cleanly would be relaunched within one reconcile
interval, and a full shutdown would never converge.

**A drain is not a desired stop.** `desiredState: stopped` means *kill this
session now* — that is what `x` and `pandamate stop` are for. Mid-shutdown the
FirstMate is still unmounting and dismissing workers, so the drain suspends both
the launching and the killing halves of reconciliation, and keeps only the
observation: a project whose session is gone is recorded `stopped` with
`Closed during a full Pandamate shutdown`. That record is what the Fleet shows
ticking over while the shutdown runs.

**Draining still writes `desiredState: stopped` for every project.** The flag
itself lives only in daemon memory, so a restart resumes ordinary supervision —
but the fleet must not come back with it. Marking the projects durably is what
makes "closed" survive the next launch; projects stay in the Fleet as inactive.

**Home is last.** `pandamate:home` hosts the TUI and the launcher process that
drives the shutdown, so killing it ends the driver. Nothing may be scheduled
after it, which is why the daemon is stopped in the previous step and why the
final progress frame is pushed to the TUI before the window is destroyed.

**Unlink before killing a straggler.** A FirstMate's window 0 is *linked* into
`pandamate:home`, not copied. Killing the session while the link exists leaves
the pane alive inside home. Forced teardown therefore reuses the supervisor's
order: `closeControlTab`, then `killSession`.

## 3. What it refuses to touch

Pandamate closes its two namespaces and nothing else:

| Session | Treated as | Closed |
| --- | --- | --- |
| `firstmate-*` | FirstMate | gracefully, then forced |
| `pandamate:home` | control plane | last, unconditionally |
| `pandamate:write`, `pandamate:idle-probe`, `pandamate:service-*`, … | control plane | before home |
| anything else | foreign | never — reported instead |

A tmux session Panda runs for their own reasons is listed in the report as left
untouched. The Fleet shows such sessions, so "everything in the Fleet" would
have been the wrong rule.

## 4. Grace, force, and honesty about outcomes

`PANDAMATE_SHUTDOWN_GRACE_MS` (default five minutes, `--timeout` on the CLI)
bounds step 3. Dismissing a crew and unmounting an Arcadia workspace is minutes
of real work, so the default is generous.

Every session ends in exactly one outcome, and the report says which:

- `closed` — it shut itself down, and Pandamate never killed it;
- `forced` — it outlasted the grace period and was stopped;
- `left-running` — `--no-force` was used and it is still up;
- `failed` — the request could not be delivered and the session could not be
  stopped either.

Before forcing anything, Pandamate looks once more: a FirstMate that closed
between the last poll and the deadline — or so promptly that delivering the
request itself failed — is recorded `closed`, never `forced`. A shutdown report
that says "forced" must mean Pandamate really killed something.

Discovery failures are never read as success. If tmux cannot be listed during a
poll, that round simply has no answer; only a session that tmux positively no
longer reports counts as closed.

Waiting reports on **every** poll, not only when something changes. The first
real shutdown took four minutes on its last FirstMate — which was doing exactly
what it had been asked, stopping servers and unwinding supervision — and a
screen that stands still for four minutes reads as a hung shutdown rather than a
patient one. The headline therefore names what is being waited for, how long it
has taken, and how much grace is left. The control log and the CLI keep their
own cadence: every change, plus a heartbeat, instead of a line per second.

## 5. Where it lives

| Piece | File |
| --- | --- |
| Plan, graceful sweep, control-session teardown | `packages/runtime-tmux/src/fleet-shutdown.ts` |
| Daemon drain (`system.drain`) | `packages/protocol`, `apps/daemon/src/server.ts` |
| Suspended supervision | `apps/daemon/src/supervisor.ts` |
| Daemon drain/stop port | `packages/client/src/index.ts` |
| `pandamate shutdown-all` | `apps/cli/src/main.ts` |
| `X`, confirmation, live progress screen | `spikes/tui/src/index.ts` |
| Orchestration inside home | `spikes/tmux/src/launch-tui.ts` |

The tmux half is driven through injected clock, sleep and daemon ports, so the
sequence is unit-tested without a tmux server; `apps/cli/src/integration.test.ts`
then proves the whole thing against a real daemon and a real tmux server, with a
stand-in FirstMate that closes its own session when asked.
