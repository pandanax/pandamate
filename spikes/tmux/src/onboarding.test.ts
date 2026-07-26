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
  assert.equal(pathOnlyInput('  "/workspace/mandala/.claude"  '), "/workspace/mandala/.claude");
  assert.equal(pathOnlyInput("/workspace/mandala/"), "/workspace/mandala/");
  assert.equal(pathOnlyInput("what is running?"), null);
});

test("resolves a configured Git FirstMate from its .claude directory", () => {
  const workspace = mkdtempSync(join(tmpdir(), "pandamate-onboarding-"));
  mkdirSync(join(workspace, ".claude"), { recursive: true });
  mkdirSync(join(workspace, ".git"), { recursive: true });
  writeFileSync(
    join(workspace, ".claude", "settings.json"),
    JSON.stringify({ env: { FM_HOME: join(workspace, ".firstmate") } }),
  );

  assert.deepEqual(
    configuredFirstMateProfile(join(workspace, ".claude")),
    {
      profile: "FirstMateGit",
      workspace,
    },
  );
});
