import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { MemoryMaterializer } from "./index.ts";

test("materializes active decisions deterministically and detects drift", () => {
  const directory = mkdtempSync(join(tmpdir(), "pandamate-memory-"));
  const decisions = [
    {
      id: "dec_1",
      topic: "ui.motion",
      value: "reduced",
      summary: "Use reduced motion.",
      source: "Panda",
      status: "active" as const,
      supersedesId: null,
      createdAt: "2026-07-26T12:00:00.000Z",
      supersededAt: null,
    },
  ];
  try {
    const materializer = new MemoryMaterializer(directory);
    const first = materializer.materialize(decisions);
    const second = materializer.materialize(decisions);
    assert.equal(first.checksum, second.checksum);
    assert.equal(materializer.check(decisions).ok, true);
    writeFileSync(materializer.indexPath, "# drift\n");
    assert.equal(materializer.check(decisions).ok, false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
