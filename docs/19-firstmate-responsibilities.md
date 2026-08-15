# FirstMate responsibilities - who owns what

Pandamate owns the common FirstMate contract and lifecycle.
Firstmate owns the Git-specific mechanics that realize that contract.
Global agent configuration only needs to know that FirstMates exist.

## Layers

- **L0 - global agent configuration:** communication style and generic environment rules.
- **L1 - Pandamate:** lifecycle, durable state, navigation, launch prompts, project merge authority, and runtime selection between Codex CLI and Claude Code.
- **L2 - Firstmate:** Git branches, worktrees, GitHub or GitLab delivery, supervision, cleanup, and gnhf integration.

## Capability matrix

| Capability | Pandamate contract | Firstmate Git implementation |
|---|---|---|
| Runtime | launch a durable coding agent | Codex CLI by default; Claude Code selectable |
| VCS | isolate code work | Git branch and worktree |
| Land code | store and pass project kind and merge mode without interpreting them | owns Git `auto` and `manual` semantics |
| Watch | supervise without spending model turns | Git watcher |
| Cleanup | preserve all unlanded work | guarded Git worktree cleanup |
| gnhf | make gnhf available | Git gnhf repository under `dev/gnhf` |

Common rules live once in [docs/18-agent-operations.md](18-agent-operations.md).
Git mechanics live once in Firstmate's instructions and scripts.
