# Agent operating notes

Common operating rules for every FirstMate raised by Pandamate live here.
Git-specific mechanics live in the Firstmate repository; this document owns the shared contract.

## Code tasks are isolated; landing is project-owned

Every code-changing task runs in its own Git worktree on its own branch.
Never edit the shared checkout in place.

Landing authority is durable project state, not a preference of the running
FirstMate.
Pandamate stores the project kind and merge mode and passes both facts unchanged
to the launched protocol through its prompt and environment.
It does not interpret those facts into VCS commands or approval rules.
The concrete Git semantics and mechanics live in Firstmate;
[docs/19](19-firstmate-responsibilities.md) indexes their owners.

## Generated documentation before commit

The root `prepare` script installs `.githooks/pre-commit`.
The hook selects the Node version pinned by `.nvmrc` and runs `pnpm docs:generate`.
If generation changes `docs/generated`, the commit stops so the author can review and stage the result.
CI independently runs `pnpm docs:check`.

## Do not clobber a shared working tree

Several sessions may share `dev/pandamate`.
Use an isolated worktree and preserve unrelated changes.
Never commit the whole shared tree.

## Reaching the real daemon

The live daemon and desktop launcher use the system temporary directory.
Control it with the system `TMPDIR`, because agent shells may use a private temporary directory and therefore a different socket.

```bash
REALT=/var/folders/6l/187kz4550gjdtd3l3lh3rjjctc50yb/T/
TMPDIR=$REALT node apps/cli/src/main.ts daemon stop
TMPDIR=$REALT node apps/cli/src/main.ts daemon start
```

Stopping the daemon does not kill tmux sessions.
Running projects remain available while supervision restarts.

## Dependency-store hygiene

Environment variables override `.npmrc`.
Before installing, ensure `NPM_CONFIG_STORE_DIR`, `NPM_CONFIG_CACHE_DIR`, and `NPM_CONFIG_VIRTUAL_STORE_DIR` do not point outside this repository.
Clear them explicitly when necessary.

```bash
env -u NPM_CONFIG_STORE_DIR -u NPM_CONFIG_CACHE_DIR -u NPM_CONFIG_VIRTUAL_STORE_DIR pnpm install
```

Check for dangling package links if the application fails despite a valid lockfile.

## Firstmate and gnhf

The maintained Git repositories are `~/Yandex.Disk.localized/dev/firstmate` and `~/Yandex.Disk.localized/dev/gnhf`.
Verify each repository's remote, branch, and cleanliness before advising or editing it.
