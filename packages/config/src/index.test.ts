import assert from "node:assert/strict";
import test from "node:test";

import { loadConfig } from "./index.ts";

test("derives bounded state and runtime files from overrides", () => {
  assert.deepEqual(
    loadConfig({
      PANDAMATE_STATE_DIR: "/private/tmp/pandamate-test-state",
      PANDAMATE_RUNTIME_DIR: "/private/tmp/pandamate-test-runtime",
    }),
    {
      stateDirectory: "/private/tmp/pandamate-test-state",
      runtimeDirectory: "/private/tmp/pandamate-test-runtime",
      databasePath: "/private/tmp/pandamate-test-state/state.sqlite3",
      socketPath: "/private/tmp/pandamate-test-runtime/pandamated.sock",
      lockPath: "/private/tmp/pandamate-test-runtime/pandamated.lock",
      logPath: "/private/tmp/pandamate-test-state/pandamated.jsonl",
      heartbeatDirectory: "/private/tmp/pandamate-test-state/heartbeats",
      hookSpoolDirectory: "/private/tmp/pandamate-test-state/hook-spool",
      memoryDirectory: "/private/tmp/pandamate-test-state/memory",
      backupsDirectory: "/private/tmp/pandamate-test-state/backups",
      tmuxSocketName: undefined,
      firstMateAdapter: "claude-code",
      claudeExecutable: "/Users/pandanax/.local/bin/claude",
      fakeFirstMateEntry: undefined,
      reconcileIntervalMs: 500,
      heartbeatStaleMs: 5000,
      shutdownGraceMs: 300_000,
      watcherRestartBackoffMs: 10_000,
    },
  );
});

test("rejects relative and oversized socket paths", () => {
  assert.throws(() =>
    loadConfig({
      PANDAMATE_STATE_DIR: "relative",
      PANDAMATE_RUNTIME_DIR: "/private/tmp/runtime",
    }),
  );
  assert.throws(() =>
    loadConfig({
      PANDAMATE_STATE_DIR: "/private/tmp/state",
      PANDAMATE_RUNTIME_DIR: `/private/tmp/${"x".repeat(100)}`,
    }),
  );
  assert.throws(() =>
    loadConfig({
      PANDAMATE_STATE_DIR: "/private/tmp/state",
      PANDAMATE_RUNTIME_DIR: "/private/tmp/runtime",
      PANDAMATE_TMUX_SOCKET_NAME: "../default",
    }),
  );
});
