# Agent operating notes

Durable, versioned guidance for any agent (a FirstMate or a worker it dispatches)
operating **on the Pandamate repo and the projects it supervises**. This lives in
the repo on purpose: Panda's standing preference is that durable context belong
here — reviewed and versioned — not in an unversioned per-session memory store.
Referenced from [CLAUDE.md](../CLAUDE.md).

## Isolate every task in its own worktree

As the FirstMate, raise every task in its own isolated worktree — a separate
"matros" (crewmate) — and don't fuss about it (Panda: «ты же firstmate! поднимай
каждую задачу в отдельно ворктри и не парься», 2026-07-28). It keeps a task's
changes off whatever branch happens to be checked out.

- **arc projects (firstmate / gnhf):** `arc mount` a worktree under
  `~/arcadia-worktrees/<name>` (shared object store), branch off fresh trunk,
  commit path-limited, open an Arcanum PR, then revert the main mount.
- **git projects (pandamate):** dispatch a worker with the Agent tool using
  `isolation: "worktree"`, or add a `git worktree`; commit there, then land.
- Isolation is about working *separately*; code changes then land as a pull
  request (see below), not by pushing the shared checkout.

## Code work lands in an isolated workspace, on a branch, as a pull request

**The rule, in one line: код → ветка → PR → main.** Code never goes straight to
`main`; it lands there only by merging its pull request.

Any FirstMate that changes code does it in its own isolated workspace — a fresh
worktree on its own branch — and lands it as a **pull request**, never by editing
the shared checkout in place. This is the default for the tasks that need it (real
code changes); prefer dispatching a worker into that worktree over doing code work
in your own session. The rule is injected into every supervising FirstMate's
launch prompt, so it holds across projects (Panda, 2026-07-28;
[D-033](08-decisions.md)).

- **arc (firstmate / gnhf):** worktree under `~/arcadia-worktrees/<name>`, branch
  off fresh trunk, commit path-limited, `arc pr create`, then revert the main mount.
- **git (pandamate):** a `git worktree` (or an Agent worker with
  `isolation: "worktree"`), commit there, push the branch, open a GitHub PR; the
  FirstMate does not merge — that is the captain's call.

Trivial, non-code landings — docs, memory pointers, ops notes — may still go
straight to `main` when the tree is not shared (Panda's earlier «любую полезность
сразу пушить в мейн», now scoped to those).

## The working tree is shared by parallel sessions

Panda runs several VS Code Claude sessions against the same `dev/pandamate`
checkout, so another session's half-finished work routinely shows up in your
files mid-task. Do **not** commit the whole tree — you would push a sibling's
unfinished change and can leave `main` not typechecking (their halves often span
several files). Commit only your own hunks, or work in a worktree. When the tree
is visibly shared, ask before committing.

## Reaching / restarting the real daemon (TMPDIR gotcha)

The live daemon and the `Pandamate.app` home TUI talk over a Unix socket whose
path derives from `tmpdir()`. The Claude Code harness runs a FirstMate shell with
`TMPDIR=/tmp/claude-<uid>`, but the real daemon runs under the **system** TMPDIR
(`/var/folders/6l/187kz4550gjdtd3l3lh3rjjctc50yb/T/`). So a plain `pandamate
daemon status|stop|start` from a FirstMate hits the wrong socket and reports "not
running" even when it is. Control the real daemon with the system TMPDIR:

```bash
REALT=/var/folders/6l/187kz4550gjdtd3l3lh3rjjctc50yb/T/
TMPDIR=$REALT node apps/cli/src/main.ts daemon stop
TMPDIR=$REALT node apps/cli/src/main.ts daemon start   # detached; runs source, so this is how code goes live
```

`PANDAMATE_SOCKET_PATH` / `PANDAMATE_HOOK_SPOOL_DIR` injected into a FirstMate's
env are decoys — `loadConfig` (`packages/config/src/index.ts`) does not read the
socket path from them. **Restart is session-safe:** `stop()` never kills tmux
sessions, and the real `claude-code` adapter takes an early "record running"
return in `supervisor.ts`, so a `running/running` project (like the pandamate
FirstMate itself) is not killed on reconcile.

## firstmate and gnhf are yours to keep current

Maintaining and developing **firstmate** and **gnhf** — all four checkouts, git
and Arcadia copies alike — is a standing job (Panda, 2026-07-27). Keep an
accurate, current picture; don't rediscover the layout each time. Confirm live
state before advising or editing (which checkout, its remote, its branch, whether
it is clean) — these move. The canonical topology lives in
[CLAUDE.md](../CLAUDE.md) and
[docs/16-firstmate-and-gnhf-topology.md](16-firstmate-and-gnhf-topology.md); when
a change makes the topology wrong, fix it there in the same breath.
