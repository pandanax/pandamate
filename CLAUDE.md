# Pandamate — agent context

Pandamate is the control plane for long-running FirstMate orchestrators. Start
from [README.md](README.md) for product state and the current handoff;
[docs/](docs/) holds the design record.

## How to operate here (read before acting)

Common operating rules for every FirstMate — **code tasks are isolated in a
Git worktree; project kind and merge mode are durable inputs to the selected
FirstMate protocol**, don't clobber
the shared working tree, how to reach/restart
the real daemon, and the standing firstmate/gnhf mandate — live in
[docs/18-agent-operations.md](docs/18-agent-operations.md). That is the canonical,
versioned home for the shared guidance (not the per-session memory store); per-VCS
specifics live in each FirstMate's own home, and
[docs/19-firstmate-responsibilities.md](docs/19-firstmate-responsibilities.md)
indexes which layer/home owns each capability.

## The projects Pandamate supervises

Pandamate supervises Git repositories and document workspaces.
The maintained Firstmate and gnhf repositories live under `~/Yandex.Disk.localized/dev/` and use Git remotes under `github.com/pandanax/`.
