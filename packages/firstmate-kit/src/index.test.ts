import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  FirstMateClient,
  firstMateWorkspaceEvidence,
  HookSpoolClient,
} from "./index.ts";

test("validates the deterministic FirstMate boundary", () => {
  const client = new FirstMateClient({
    socketPath: "/tmp/pandamate.sock",
    projectSlug: "mandala",
    instanceId: "fixture-1",
  });
  assert.equal(client.leaseOwner, "firstmate:fixture-1");
  assert.throws(
    () =>
      new FirstMateClient({
        socketPath: "relative.sock",
        projectSlug: "mandala",
      }),
  );
});

test("atomically spools a hook while the daemon is unavailable", async () => {
  const directory = mkdtempSync(join(tmpdir(), "pandamate-hook-spool-"));
  try {
    const client = new HookSpoolClient({
      socketPath: join(directory, "missing.sock"),
      spoolDirectory: join(directory, "spool"),
    });
    assert.equal(
      await client.ingest({
        projectSlug: "mandala",
        hookId: "hook-fixture-123",
        eventType: "session.started",
        occurredAt: "2026-07-26T12:00:00.000Z",
        payload: { sessionId: "session-1" },
      }),
      "spooled",
    );
    const names = readdirSync(join(directory, "spool"));
    assert.equal(names.length, 1);
    assert.match(names[0] ?? "", /\.json$/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("reads an existing FirstMate watcher heartbeat and latest status", () => {
  const workspace = mkdtempSync(join(tmpdir(), "pandamate-heartbeat-"));
  const claudeProjects = mkdtempSync(
    join(tmpdir(), "pandamate-claude-projects-"),
  );
  try {
    const state = join(workspace, ".firstmate", "state");
    mkdirSync(state, { recursive: true });
    const heartbeat = join(state, ".last-watcher-beat");
    const olderStatus = join(state, "older.status");
    const latestStatus = join(state, "latest.status");
    writeFileSync(heartbeat, "");
    writeFileSync(olderStatus, "done: older message\n");
    writeFileSync(
      latestStatus,
      "working: first line\nworking: latest message\n",
    );
    const heartbeatTime = new Date("2026-07-26T01:02:03.000Z");
    utimesSync(heartbeat, heartbeatTime, heartbeatTime);
    utimesSync(
      olderStatus,
      new Date("2026-07-26T00:00:00.000Z"),
      new Date("2026-07-26T00:00:00.000Z"),
    );
    utimesSync(
      latestStatus,
      new Date("2026-07-26T01:00:00.000Z"),
      new Date("2026-07-26T01:00:00.000Z"),
    );
    const transcriptDirectory = join(
      claudeProjects,
      workspace.replaceAll("/", "-"),
    );
    mkdirSync(transcriptDirectory, { recursive: true });
    const transcript = join(transcriptDirectory, "main.jsonl");
    writeFileSync(
      transcript,
      [
        JSON.stringify({
          type: "assistant",
          cwd: "/another/worktree",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "wrong workspace" }],
          },
        }),
        JSON.stringify({
          type: "assistant",
          cwd: workspace,
          message: {
            role: "assistant",
            content: [{ type: "thinking", thinking: "private" }],
          },
        }),
        JSON.stringify({
          type: "assistant",
          cwd: workspace,
          message: {
            role: "assistant",
            content: [
              {
                type: "text",
                text: "Captain, the latest structured reply is ready.",
              },
            ],
          },
        }),
      ].join("\n"),
    );
    const transcriptTime = new Date("2026-07-26T01:03:04.000Z");
    utimesSync(transcript, transcriptTime, transcriptTime);

    assert.deepEqual(
      firstMateWorkspaceEvidence(`${workspace}/`, claudeProjects),
      {
        heartbeatAt: transcriptTime.toISOString(),
        latestStatus: "working: latest message",
        lastAssistantMessage:
          "Captain, the latest structured reply is ready.",
      },
    );
  } finally {
    rmSync(workspace, { recursive: true, force: true });
    rmSync(claudeProjects, { recursive: true, force: true });
  }
});
