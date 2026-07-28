# Agent operating notes

Common operating rules for any FirstMate the Pandamate control plane raises — git
and arc alike. The two differ in mechanics, not in principle, so the shared rules
live here, in the Pandamate repo (versioned and reviewed, not in a per-session
memory store). **Per-VCS specifics live in each FirstMate's own home** — the arc
FirstMate's `AGENTS.md`, the git FirstMate's own docs — not here. Referenced from
[CLAUDE.md](../CLAUDE.md).

## Code tasks are isolated — код → ветка → PR → main

Every task that changes code runs in its own isolated workspace: a fresh worktree
on its own branch, landing **only** by merging a pull request. Never edit the
shared checkout in place, and never push code straight to `main`. Isolate such
tasks by default, and prefer dispatching a worker into that worktree over doing
code in your own session. This rule is injected into every supervising FirstMate's
launch prompt (Panda, 2026-07-28; [D-033](08-decisions.md)).

Trivial, non-code landings — docs, memory pointers, ops notes — may go straight to
`main` when the tree is not shared.

The per-VCS mechanics — arc (`arc mount` + `arc pr create`, Arcanum) vs git (`git
worktree` + a GitHub PR) — are documented in each FirstMate's own home, not here.

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

## firstmate and gnhf are yours to keep current

Maintaining and developing **firstmate** and **gnhf** — all four checkouts, git and
Arcadia copies alike — is a standing job (Panda, 2026-07-27). Keep an accurate,
current picture; don't rediscover the layout each time. Confirm live state before
advising or editing (which checkout, its remote, its branch, whether it is clean) —
these move. The canonical topology lives in [CLAUDE.md](../CLAUDE.md) and
[docs/16-firstmate-and-gnhf-topology.md](16-firstmate-and-gnhf-topology.md); when a
change makes the topology wrong, fix it there in the same breath.
