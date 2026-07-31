import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  FakeFirstMate,
  parseFakeFirstMateOptions,
} from "./index.ts";

test("parses bounded fake FirstMate options", () => {
  assert.deepEqual(
    parseFakeFirstMateOptions([
      "--project",
      "mandala",
      "--heartbeat",
      "/tmp/mandala.heartbeat",
      "--control",
      "/tmp/mandala.control",
      "--interval-ms",
      "250",
    ]),
    {
      projectSlug: "mandala",
      heartbeatPath: "/tmp/mandala.heartbeat",
      controlPath: "/tmp/mandala.control",
      intervalMs: 250,
    },
  );
  assert.throws(() =>
    parseFakeFirstMateOptions([
      "--project",
      "../unsafe",
      "--heartbeat",
      "/tmp/h",
      "--control",
      "/tmp/c",
      "--interval-ms",
      "1",
    ]),
  );
});

test("writes atomic heartbeats and applies deterministic controls", () => {
  const directory = mkdtempSync(join(tmpdir(), "fake-firstmate-"));
  const heartbeatPath = join(directory, "heartbeat.json");
  const controlPath = join(directory, "control");
  try {
    const fixture = new FakeFirstMate({
      projectSlug: "mandala",
      heartbeatPath,
      controlPath,
      intervalMs: 250,
    });
    const first = fixture.heartbeat(new Date("2026-07-26T00:00:00.000Z"));
    assert.equal(first.sequence, 1);
    assert.deepEqual(
      JSON.parse(readFileSync(heartbeatPath, "utf8")),
      first,
    );
    writeFileSync(controlPath, "pause\n");
    assert.equal(fixture.tick(new Date("2026-07-26T00:00:01.000Z")), "continue");
    assert.equal(
      JSON.parse(readFileSync(heartbeatPath, "utf8")).state,
      "waiting",
    );
    writeFileSync(controlPath, "exit\n");
    assert.equal(fixture.tick(), "exit");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
