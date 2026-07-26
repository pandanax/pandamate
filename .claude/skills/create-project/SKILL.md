---
name: create-project
description: Create and start a durable Pandamate project from a local folder. Use when Panda drops or names a folder and asks to create, onboard, raise, launch, or run it as FirstMateArc, FirstMateGit, DocResearch, FirstMateDocs, arc, git, or docs.
---

# Create Project

Turn one existing local directory into one supervised Pandamate project.

## Workflow

1. Require a normalized absolute directory path and one profile.
2. Map profiles exactly:
   - `FirstMateArc` or `arc` -> `arc`
   - `FirstMateGit` or `git` -> `git`
   - `DocResearch`, `FirstMateDocs`, or `docs` -> `docs`
3. Refuse to guess the profile when it is absent.
4. Run from the Pandamate repository:

```bash
pnpm pandamate project create <profile> <absolute-folder>
```

5. Verify with `pnpm pandamate project show <derived-slug>`.
6. Report the public profile, workspace, slug, desired state, actual state, and
   tmux session when available.
7. Do not create a second registration when the slug already exists. Show the
   existing project and ask for an explicit rename or reuse decision.

## Runtime identity

Explain this when Panda asks where FirstMate lives:

- Pandamate starts the main FirstMate as a long-running Claude Code process.
- The executable defaults to `~/.local/bin/claude`.
- The process starts in the registered workspace.
- Its tmux session is `pandamate:<project-slug>`.
- The selected profile and FirstMate operating contract are injected in the
  launch prompt. FirstMate is a role and supervised process, not a separate
  hidden executable.

## Examples

Input: `Подними /Users/panda/dev/site как FirstMateGit`

```bash
pnpm pandamate project create FirstMateGit /Users/panda/dev/site
```

Input: `Создай DocResearch "/Users/panda/Documents/Case Files"`

```bash
pnpm pandamate project create DocResearch "/Users/panda/Documents/Case Files"
```
