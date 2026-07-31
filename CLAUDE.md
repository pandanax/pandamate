# Pandamate — agent context

Pandamate is the control plane for long-running FirstMate orchestrators. Start
from [README.md](README.md) for product state and the current handoff;
[docs/](docs/) holds the design record.

## How to operate here (read before acting)

Common operating rules for every FirstMate — **code tasks are isolated in a
worktree; landing follows durable project merge mode (git → PR + required CI,
then auto or manual merge; arc → PR + CI)**, don't clobber
the shared working tree, how to reach/restart
the real daemon, and the standing firstmate/gnhf mandate — live in
[docs/18-agent-operations.md](docs/18-agent-operations.md). That is the canonical,
versioned home for the shared guidance (not the per-session memory store); per-VCS
specifics live in each FirstMate's own home, and
[docs/19-firstmate-responsibilities.md](docs/19-firstmate-responsibilities.md)
indexes which layer/home owns each capability.

## The projects Pandamate supervises

firstmate and gnhf each exist **twice** — a git copy and an Arcadia copy — and
confusing them wastes real work:

| | git — `~/Yandex.Disk.localized/dev/` | arc — `~/arcadia/junk/pandanax/` |
| --- | --- | --- |
| **firstmate** | `dev/firstmate` → `github.com/pandanax/firstmate` | `junk/pandanax/firstmate` |
| **gnhf** | `dev/gnhf` → `github.com/pandanax/gnhf` | `junk/pandanax/gnhf-arc` |

The four traps, in short:

- Typing `gnhf` runs the **arc** fork (`junk/pandanax/gnhf-arc`), never
  `dev/gnhf`. It reaches it through an nvm symlink that any directory move
  breaks.
- The arc copies are `arc`, not git: no `origin`, branches publish as
  `users/pandanax/<name>` (so never write that prefix yourself), and trunk
  refuses direct pushes — changes land via `arc pr create`.
- A shared arc worktree may host another agent. Check `arc status` before
  switching branches, and commit path-limited.
- Both git repos were moved off the `kunchenguid` upstream to `pandanax` forks;
  `upstream` was removed on purpose, but `CHANGELOG.md` links still point
  upstream on purpose too — they reference commits absent from our forks.

Full detail, including the crew/store lifecycle and how to audit stale arc
stores: [docs/16-firstmate-and-gnhf-topology.md](docs/16-firstmate-and-gnhf-topology.md).
Verify the live state before acting on any of it; these paths have moved before.
