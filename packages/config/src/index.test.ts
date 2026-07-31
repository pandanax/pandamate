import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { loadConfig } from "./index.ts";

test("derives bounded state and runtime files from overrides", () => {
  const stateDirectory = join(tmpdir(), "pandamate-test-state");
  const runtimeDirectory = join(tmpdir(), "pandamate-test-runtime");
  const claudeExecutable = join(tmpdir(), "pandamate-test-claude");
  assert.deepEqual(
    loadConfig({
      PANDAMATE_STATE_DIR: stateDirectory,
      PANDAMATE_RUNTIME_DIR: runtimeDirectory,
      PANDAMATE_CLAUDE_EXECUTABLE: claudeExecutable,
    }),
    {
      stateDirectory,
      runtimeDirectory,
      databasePath: join(stateDirectory, "state.sqlite3"),
      socketPath: join(runtimeDirectory, "pandamated.sock"),
      lockPath: join(runtimeDirectory, "pandamated.lock"),
      logPath: join(stateDirectory, "pandamated.jsonl"),
      heartbeatDirectory: join(stateDirectory, "heartbeats"),
      hookSpoolDirectory: join(stateDirectory, "hook-spool"),
      memoryDirectory: join(stateDirectory, "memory"),
      backupsDirectory: join(stateDirectory, "backups"),
      tmuxSocketName: undefined,
      firstMateAdapter: "claude-code",
      claudeExecutable,
      firstMateHome: undefined,
      fakeFirstMateEntry: undefined,
      reconcileIntervalMs: 500,
      heartbeatStaleMs: 5000,
      shutdownGraceMs: 300_000,
      watcherRestartBackoffMs: 10_000,
    },
  );
});

test("accepts an absolute firstmate home and rejects a relative one", () => {
  const stateDirectory = join(tmpdir(), "state");
  const runtimeDirectory = join(tmpdir(), "runtime");
  const firstMateHome = join(tmpdir(), "arcadia/junk/pandanax/firstmate");
  assert.equal(
    loadConfig({
      PANDAMATE_STATE_DIR: stateDirectory,
      PANDAMATE_RUNTIME_DIR: runtimeDirectory,
      PANDAMATE_FIRSTMATE_HOME: firstMateHome,
    }).firstMateHome,
    firstMateHome,
  );
  assert.throws(() =>
    loadConfig({
      PANDAMATE_STATE_DIR: stateDirectory,
      PANDAMATE_RUNTIME_DIR: runtimeDirectory,
      PANDAMATE_FIRSTMATE_HOME: "relative/firstmate",
    }),
  );
});

test("rejects relative and oversized socket paths", () => {
  const stateDirectory = join(tmpdir(), "state");
  const runtimeDirectory = join(tmpdir(), "runtime");
  assert.throws(() =>
    loadConfig({
      PANDAMATE_STATE_DIR: "relative",
      PANDAMATE_RUNTIME_DIR: runtimeDirectory,
    }),
  );
  assert.throws(() =>
    loadConfig({
      PANDAMATE_STATE_DIR: stateDirectory,
      PANDAMATE_RUNTIME_DIR: join(tmpdir(), "x".repeat(100)),
    }),
  );
  assert.throws(() =>
    loadConfig({
      PANDAMATE_STATE_DIR: stateDirectory,
      PANDAMATE_RUNTIME_DIR: runtimeDirectory,
      PANDAMATE_TMUX_SOCKET_NAME: "../default",
    }),
  );
});
