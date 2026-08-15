import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  configuredFirstMateProfile,
  pathOnlyInput,
} from "./onboarding.ts";

test("normalizes a path-only Pandamate input", () => {
  assert.equal(pathOnlyInput('  "/workspace/mandala/.codex"  '), "/workspace/mandala/.codex");
  assert.equal(pathOnlyInput("/workspace/mandala/"), "/workspace/mandala/");
  assert.equal(pathOnlyInput("what is running?"), null);
});

test("does not treat legacy .claude settings as FirstMate configuration", () => {
  const workspace = mkdtempSync(join(tmpdir(), "pandamate-onboarding-"));
  mkdirSync(join(workspace, ".claude"), { recursive: true });
  mkdirSync(join(workspace, ".git"), { recursive: true });
  writeFileSync(
    join(workspace, ".claude", "settings.json"),
    JSON.stringify({ env: { FM_HOME: join(workspace, ".firstmate") } }),
  );

  assert.throws(
    () => configuredFirstMateProfile(workspace),
    /No FirstMate configuration found/,
  );
});

test("resolves a configured Git FirstMate from its .codex directory", () => {
  const workspace = mkdtempSync(join(tmpdir(), "pandamate-codex-onboarding-"));
  mkdirSync(join(workspace, ".codex"), { recursive: true });
  mkdirSync(join(workspace, ".git"), { recursive: true });
  writeFileSync(
    join(workspace, ".codex", "config.toml"),
    'project_doc_fallback_filenames = ["FIRSTMATE.md"]\n',
  );

  assert.deepEqual(configuredFirstMateProfile(join(workspace, ".codex")), {
    profile: "FirstMateGit",
    workspace,
  });
});
