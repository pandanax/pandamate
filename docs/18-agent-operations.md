# Agent operating notes

Common operating rules for any FirstMate the Pandamate control plane raises — git
and arc alike. The two differ in mechanics, not in principle, so the shared rules
live here, in the Pandamate repo (versioned and reviewed, not in a per-session
memory store). **Per-VCS specifics live in each FirstMate's own home** — the arc
FirstMate's `AGENTS.md`, the git FirstMate's own docs — not here. Which layer and
which home owns each capability is indexed in
[docs/19-firstmate-responsibilities.md](19-firstmate-responsibilities.md).
Referenced from [CLAUDE.md](../CLAUDE.md).

## Code tasks are isolated; landing is per-VCS

Every task that changes code runs in its own isolated worktree on its own branch —
never edit the shared checkout in place. Isolate such tasks by default, and prefer
dispatching a worker into that worktree over doing code in your own session
(Panda, 2026-07-28; [D-033](08-decisions.md)).

**Landing is the home's call, and it differs by VCS:**

- **git** — push an isolated branch, open a PR, enable the forge's native
  auto-merge, and watch required CI. The protected default branch accepts the
  change only after those checks pass; do not push it directly. Panda's standing
  approval covers routine auto-merge through this gate, so do not ask again.
- **arc** — open a PR and watch CI; never merge or deploy (the captain merges).
- When the landing mode is genuinely unclear for a change, **ask «push or PR?»**
  rather than guessing.

The concrete per-VCS mechanics live in each FirstMate's own home;
[docs/19](19-firstmate-responsibilities.md) indexes them.

## Generated documentation before commit

This repository installs `.githooks/pre-commit` through the root `prepare`
script. The hook runs `pnpm docs:generate` on every commit. If generation changes
anything under `docs/generated`, the commit stops so the author can review and
stage the result before retrying. It never stages files silently. CI then runs
`pnpm docs:check` as the independent clean-checkout gate.

## Don't clobber a shared working tree

Panda runs several Claude sessions against the same `dev/pandamate` checkout, so
another session's half-finished work routinely shows up in your files mid-task.
Never commit the whole tree — you would push a sibling's unfinished change and can
leave `main` not typechecking. Work in a worktree, or commit only your own hunks;
when the tree is visibly shared, ask before committing.

## Reaching / restarting the real daemon (TMPDIR gotcha)

The live daemon and the `Pandamate.app` home TUI talk over a Unix socket whose path
derives from `tmpdir()`. The Claude Code harness runs a FirstMate shell with
`TMPDIR=/tmp/claude-<uid>`, but the real daemon runs under the **system** TMPDIR
(`/var/folders/6l/187kz4550gjdtd3l3lh3rjjctc50yb/T/`). So a plain `pandamate daemon
status|stop|start` from a FirstMate hits the wrong socket and reports "not running"
even when it is. Control the real daemon with the system TMPDIR:

```bash
REALT=/var/folders/6l/187kz4550gjdtd3l3lh3rjjctc50yb/T/
TMPDIR=$REALT node apps/cli/src/main.ts daemon stop
TMPDIR=$REALT node apps/cli/src/main.ts daemon start   # detached; runs source, so this is how code goes live
```

`PANDAMATE_SOCKET_PATH` / `PANDAMATE_HOOK_SPOOL_DIR` injected into a FirstMate's env
are decoys — `loadConfig` (`packages/config/src/index.ts`) does not read the socket
path from them. **Restart is session-safe:** `stop()` never kills tmux sessions,
and the real `claude-code` adapter takes an early "record running" return in
`supervisor.ts`, so a `running/running` project (like the pandamate FirstMate
itself) is not killed on reconcile.

## The pnpm virtual store is hijackable from outside the repo (2026-07-29)

`~/.zshrc` used to export `NPM_CONFIG_STORE_DIR` / `NPM_CONFIG_CACHE_DIR` /
`NPM_CONFIG_VIRTUAL_STORE_DIR` globally, pointing at `~/monomarket-external/…` —
an Arc VFS workaround that monomarket needs and every other repo does not. So a
`pnpm install` here put this workspace's virtual store in monomarket's shared
directory; a later monomarket install pruned packages this repo still linked
into, and the links dangled. The Home TUI then died instantly on `Cannot find
package '@anthropic-ai/claude-agent-sdk'`, and the desktop launcher reported only
"Home did not render in time".

The exports are now scoped by a `chpwd` hook that sets them inside monomarket and
unsets them everywhere else. Three things are still worth knowing:

- **Env beats `.npmrc`.** A project `.npmrc` cannot defend against this — pnpm
  ranks the environment above project config. Verified, not assumed.
- **Shells started before the fix still carry the old values, and children
  inherit them.** `pnpm store path` returning a `monomarket-external` path is the
  tell. When in doubt, install with the vars explicitly cleared:
  `env -u NPM_CONFIG_STORE_DIR -u NPM_CONFIG_CACHE_DIR -u NPM_CONFIG_VIRTUAL_STORE_DIR pnpm install`.
- **The symptom is a dangling symlink, not a missing package**, so the lockfile
  and `pnpm list` look fine. Check the links and the recorded store directly:

```bash
find node_modules packages/*/node_modules apps/*/node_modules \
     spikes/*/node_modules fixtures/*/node_modules \
     -maxdepth 2 -type l ! -exec test -e {} \; -print    # dangling links
grep -n 'storeDir\|virtualStoreDir' node_modules/.modules.yaml
```

`virtualStoreDir` should read `.pnpm`. Anything absolute and outside the repo
means the next install will silently rot again.

## firstmate and gnhf are yours to keep current

Maintaining and developing **firstmate** and **gnhf** — all four checkouts, git and
Arcadia copies alike — is a standing job (Panda, 2026-07-27). Keep an accurate,
current picture; don't rediscover the layout each time. Confirm live state before
advising or editing (which checkout, its remote, its branch, whether it is clean) —
these move. The canonical topology lives in [CLAUDE.md](../CLAUDE.md) and
[docs/16-firstmate-and-gnhf-topology.md](16-firstmate-and-gnhf-topology.md); when a
change makes the topology wrong, fix it there in the same breath.
