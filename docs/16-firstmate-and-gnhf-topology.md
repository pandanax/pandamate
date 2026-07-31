# 16. FirstMate and gnhf topology

Pandamate supervises FirstMates; this document says where those FirstMates — and
the gnhf loop runner they use — physically live, and what is different about
each copy. It is the canonical record: memory files and agent context are
allowed to summarize it, never to contradict it.

Verified 2026-07-27.

## 1. Four checkouts, two worlds

Both projects exist twice. The git copies sit side by side, and the Arcadia
copies sit side by side, mirroring each other:

| | git — `~/Yandex.Disk.localized/dev/` | arc — `~/arcadia/junk/pandanax/` |
| --- | --- | --- |
| **firstmate** | `dev/firstmate` → `github.com/pandanax/firstmate` | `junk/pandanax/firstmate` |
| **gnhf** | `dev/gnhf` → `github.com/pandanax/gnhf` | `junk/pandanax/gnhf-arc` |

Neither pair is a mirror of the other in content: the Arcadia gnhf is a **fork**
whose VCS layer drives `arc` instead of `git` (see §4), and the Arcadia
firstmate carries the crew lifecycle that the git one does not exercise.

## 2. The git side

Both repositories were migrated off the upstream author `kunchenguid/*` to our
own forks on 2026-07-27, and their `upstream` remotes were **deliberately
removed** — a plain `git push` goes to `pandanax/*`.

- Everything unpushed was carried over, including two firstmate branches that
  upstream deleted mid-migration and that were never merged.
- `CHANGELOG.md` links still point at `kunchenguid` **on purpose**: they
  reference real upstream PRs, issues, and commits that do not exist in our
  forks. Do not rewrite them. README, `package.json`, and contributor
  instructions were retargeted.
- `dev/gnhf`'s `gnhf-git` alias in `~/.zshrc` needs `pnpm install` before it
  runs; its dependency symlinks point into a stale `~/monomarket-external`
  store. This predates the move.

## 3. The arc side

The Arcadia copies are `arc` working trees, not git clones. What that changes:

- There is no `origin`. `arc push` publishes a branch as
  `users/pandanax/<branch>`, so never put `users/<login>/` in a branch name —
  the prefix would double.
- **Trunk refuses direct pushes** (`Create & fast-forward are forbidden for
  ref=trunk`). Anything landing in trunk goes through `arc pr create`, even a
  pure directory rename.
- `arc commit` on trunk needs `--force`; prefer a branch.
- One shared worktree can host another agent at the same time. Check
  `arc status` before switching branches: a checkout changes the branch for
  everyone in that mount, and path-limited commits are the only safe way to
  avoid sweeping someone else's uncommitted work into yours.

## 4. The global `gnhf` command is the arc fork

Typing `gnhf` runs the **Arcadia** fork, not `dev/gnhf`:

```text
nvm bin/gnhf → lib/node_modules/gnhf-arc → ~/arcadia/junk/pandanax/gnhf-arc/dist/cli.mjs
```

- Moving the `gnhf-arc` directory breaks the command until that symlink is
  repointed by hand.
- `dist/cli.mjs` is a standalone bundle (`noExternal`), so it needs no
  `node_modules` at runtime — which is why the fork can live inside the Arcadia
  tree at all.
- `~/gnhf-src` is its build workspace, with `node_modules` on the real
  filesystem because arc's VFS cannot host them. It looks redundant — its
  working-tree edits are byte-identical to the committed fork — but
  `gnhf-arc/VENDOR.md` documents it as the place to rebuild from.
- `--worktree` mode is unsupported on arc. Run gnhf **inside** a crew worktree
  with `--current-branch`.

## 5. Crew worktrees and arc stores

`junk/pandanax/firstmate/bin/` owns the crewmate lifecycle, and with it the only
thing that keeps arc stores from accumulating:

| Command | Effect on the store |
| --- | --- |
| `crew-mount <name>` | creates the worktree and its store |
| `crew-unmount <name>` | unmounts, **keeps** the store for build-cache reuse |
| `crew-destroy <name>` | unmount + prune `~/.arc/mount-points` + `rm -rf` store |
| `crew-retire <name>` | kill tmux window → `crew-destroy` → FYI escalation |

`bin/fm-watch` calls `crew-retire` automatically once a crewmate's PR reaches
`merged` or `discarded`, so the normal path leaves nothing behind.

That only holds while the watcher is actually running, and until 2026-07-27 it
was not: `bin/fm-up` is the only thing that ever started it, and a FirstMate
launched by Pandamate never goes through `fm-up`. Both halves now meet in the
middle — Pandamate deploys `firstmate/bin/fm-watch` as window `watch` of the
project session and redeploys it when it exits ([D-028](08-decisions.md)), and
`bin/_common.sh` takes `CREW_SESSION` from `PANDAMATE_TMUX_SESSION`, so
crewmates, the watcher, and `crew-retire` all work in the session the captain is
looking at instead of a second, invisible `crew` session with its own first mate.
`crew-retire` additionally refuses to kill window `0`, which is the FirstMate's
own and, under Pandamate, is named after the project rather than `firstmate`.

**Known gap:** this covers only worktrees created through `crew-mount`. Anything
mounted by hand with `arc mount` is swept by nobody. Stale stores are expensive
— a single one held 7.1 GB. To audit:

```sh
arc mount --list                 # [unmounted] entries are candidates
du -sh ~/.arc/stores/*
arc unmount --forget <mountpoint>  # unmount + remove the store
```

Before deleting any store, confirm nothing is lost: compare `.arc/refs/heads/*`
against `.arc/refs/remotes/arcadia/*` (equal ids mean everything is pushed),
check `arc pr list -S all --ticket <TICKET>` for the branch's fate, and count
files under `.overlay_v2/file_data` (that is where uncommitted content lives;
the bulk of a store's size is usually just VFS cache).

## 6. Checking the live state

The topology moves. Before advising or editing, verify rather than recall:

```sh
git -C ~/Yandex.Disk.localized/dev/firstmate remote -v && git -C ~/Yandex.Disk.localized/dev/firstmate status -sb
git -C ~/Yandex.Disk.localized/dev/gnhf remote -v && git -C ~/Yandex.Disk.localized/dev/gnhf status -sb
arc status --short ~/arcadia/junk/pandanax          # from inside the mount
readlink ~/.nvm/versions/node/*/lib/node_modules/gnhf-arc
```

## 7. Open item at the 2026-07-27 verification

At that verification, the move of the arc fork out of
`firstmate/vendor/gnhf-arc` into
`junk/pandanax/gnhf-arc` is committed locally and published as
[PR 14660958](https://a.yandex-team.ru/review/14660958). Its merge and local
trunk state are deliberately not asserted as current here; recheck the PR and
live checkout before relying on them.
