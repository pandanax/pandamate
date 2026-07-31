# FirstMate responsibilities — who owns what

How responsibility is layered across the global agent config, Pandamate, and the
two FirstMate homes. Rule of thumb: **Pandamate owns what is common to every
FirstMate (the "what"); each FirstMate home owns its VCS-specific "how"; the
global config knows only that FirstMates exist.** The common rules themselves are
in [docs/18-agent-operations.md](18-agent-operations.md); this file is the index
of who realizes each capability.

## Layers

- **L0 — Global `~/.claude/`** (every session, any repo): language/comms, generic
  environment rules (Arcadia search, wiki, skills, arc branch naming), and one
  line that Pandamate exists as a super-orchestrator of FirstMates. Nothing about
  how FirstMates operate.
- **L1 — Pandamate (`dev/pandamate`, git) — the common core:** the control-plane
  lifecycle (raise / observe / direct / resume / recover / close), durable state,
  and the launch prompt that injects the common FirstMate contract — isolate every
  code task in a worktree; code lands via review; supervise workers; never touch
  other projects; report status/checkpoints; keep the topology current
  ([docs/18](18-agent-operations.md)). It names the capabilities each FirstMate
  realizes its own way, but never their mechanics.
- **L2 — FirstMate-Git (`dev/firstmate`) knows git · FirstMate-Arc
  (`junk/pandanax/firstmate`) knows arc:** the VCS-specific "how", each in its own
  home's `AGENTS.md`.

## Capability matrix

| Capability | Common contract (Pandamate) | FirstMate-Git | FirstMate-Arc |
|---|---|---|---|
| VCS | work in a worktree of your project's VCS | git: branch, `git worktree`, `gh` | arc: `arc mount`, Arcanum |
| Land code | store and pass the project's kind and merge mode without interpreting them | owns Git `auto` and `manual` semantics in `AGENTS.md` section 7 | owns Arc landing semantics in its `AGENTS.md` |
| Worktree | isolate every code task | `git worktree` | `arc mount` → `~/arcadia-worktrees/` |
| Watch | a zero-LLM watcher supervises the crew | git watcher | `bin/fm-watch` |
| Cleanup | reap finished work; leave nothing dangling | git worktree prune / reap | `crew-retire` / `reap_orphans` |
| gnhf | you can run gnhf | git gnhf (`dev/gnhf`) | arc gnhf (`junk/pandanax/gnhf-arc`) |

## The principle

Pandamate says WHAT every FirstMate must do; each home says HOW for its VCS; the
global config knows only that FirstMates exist. No common rule is duplicated across
the two homes — it lives once, in Pandamate. Where git and arc genuinely diverge —
landing/deploy, watcher, cleanup, the gnhf fork — the difference lives in that
home's `AGENTS.md`, and this matrix is the index to it.
