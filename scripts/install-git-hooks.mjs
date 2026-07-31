#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

try {
  execFileSync("git", ["rev-parse", "--is-inside-work-tree"], {
    cwd: root,
    stdio: "ignore",
  });
  execFileSync("git", ["config", "core.hooksPath", ".githooks"], {
    cwd: root,
    stdio: "ignore",
  });
  process.stdout.write("Git hooks installed from .githooks.\n");
} catch {
  process.stdout.write("Skipping Git hooks outside a git worktree.\n");
}
