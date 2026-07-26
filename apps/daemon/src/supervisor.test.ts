import assert from "node:assert/strict";
import test from "node:test";

import { firstMateProfileForProject } from "./supervisor.ts";

test("maps durable project kinds to public FirstMate profiles", () => {
  assert.equal(
    firstMateProfileForProject({ kind: "arc" }).name,
    "FirstMateArc",
  );
  assert.equal(
    firstMateProfileForProject({ kind: "git" }).name,
    "FirstMateGit",
  );
  assert.equal(
    firstMateProfileForProject({ kind: "docs" }).name,
    "DocResearch",
  );
});
