# Generated reference

These files contain facts derived mechanically from the current source tree:

- [CLI](cli.md) — the exact usage text printed by `pandamate`;
- [protocol and domain](protocol.md) — IPC request names, domain vocabularies,
  and the TUI control surface;
- [storage](storage.md) — the ordered SQLite migration inventory;
- [workspace](workspace.md) — root scripts, packages, workspace dependencies,
  binaries, and runtime environment-variable occurrences.

Do not edit the generated files directly. Change their source in code and run:

```bash
pnpm docs:generate
```

`pnpm docs:check` performs the same derivation in memory and fails if the
committed files differ. It never rewrites the working tree. The root
`pnpm check` and CI both include this drift check.

Narrative documents remain reviewed, human-readable design records. Phase
status, rationale, acceptance interpretation, and future intent are outside the
generated layer.
