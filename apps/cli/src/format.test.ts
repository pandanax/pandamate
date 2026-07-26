import assert from "node:assert/strict";
import test from "node:test";

import { formatEvents, formatProjects } from "./format.ts";

test("formats empty projections explicitly", () => {
  assert.equal(formatProjects([]), "No registered projects.\n");
  assert.equal(formatEvents([]), "No events recorded.\n");
});
