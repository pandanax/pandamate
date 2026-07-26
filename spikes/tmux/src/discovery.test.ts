import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  projectSummariesFromDaemon,
  projectSummariesFromTmux,
  serviceSummariesFromTmux,
} from "./discovery.ts";

test("discovered live sessions are running, not falsely working", () => {
  assert.deepEqual(
    projectSummariesFromTmux([
      {
        id: "$1",
        name: "firstmate",
        attachedClients: 0,
        windowCount: 8,
        livePaneCount: 8,
        commands: ["2.1.159", "zsh"],
        paths: ["/workspace"],
      },
      {
        id: "$2",
        name: "pandamate:home",
        attachedClients: 1,
        windowCount: 1,
        livePaneCount: 1,
        commands: ["node"],
        paths: ["/pandamate"],
      },
    ]),
    [
      {
        name: "firstmate",
        profile: null,
        sessionName: "firstmate",
        state: "running",
        summary: "8 windows · 8 live panes · 2.1.159, zsh",
        lastMessage: null,
        heartbeatSeconds: null,
        tmuxWindowCount: 8,
      },
    ],
  );
});

test("control-plane sessions are excluded from the project fleet", () => {
  assert.deepEqual(
    projectSummariesFromTmux([
      {
        id: "$2",
        name: "pandamate:write",
        attachedClients: 1,
        windowCount: 1,
        livePaneCount: 1,
        commands: ["node"],
        paths: ["/pandamate"],
      },
    ]),
    [],
  );
});

test("control-plane sessions are projected as Pandamate services", () => {
  assert.deepEqual(
    serviceSummariesFromTmux([
      {
        id: "$2",
        name: "pandamate:write",
        attachedClients: 1,
        windowCount: 1,
        livePaneCount: 1,
        commands: ["node"],
        paths: ["/pandamate"],
      },
      {
        id: "$3",
        name: "firstmate-mandala",
        attachedClients: 0,
        windowCount: 2,
        livePaneCount: 2,
        commands: ["node"],
        paths: ["/workspace/mandala"],
      },
    ]),
    [
      {
        name: "pandamate:write",
        state: "running",
        summary: "1 windows · 1 live panes · 1 attached",
      },
    ],
  );
});

test("daemon projects remain in Fleet after their runtime stops", () => {
  const summary = projectSummariesFromDaemon(
    [
      {
        id: "prj_1",
        slug: "mandala",
        title: "Mandala",
        kind: "git",
        workspace: "/workspace/mandala",
        desiredState: "stopped",
        actualState: "stopped",
        tmuxTarget: null,
        tmuxSessionName: "firstmate-mandala",
        currentSummary: "Stopped",
        attentionLevel: "none",
        lastHeartbeatAt: "2026-07-26T00:00:00.000Z",
        version: 3,
        createdAt: "2026-07-25T00:00:00.000Z",
        updatedAt: "2026-07-26T00:00:00.000Z",
      },
    ],
    new Date("2026-07-26T00:00:05.000Z"),
  );
  assert.equal(summary[0]?.state, "stopped");
  assert.equal(summary[0]?.profile, "FirstMateGit");
  assert.equal(summary[0]?.sessionName, null);
  assert.equal(summary[0]?.heartbeatSeconds, 5);
});

test("Fleet overlays existing FirstMate heartbeat and status evidence", () => {
  const workspace = mkdtempSync(join(tmpdir(), "pandamate-fleet-evidence-"));
  try {
    const state = join(workspace, ".firstmate", "state");
    mkdirSync(state, { recursive: true });
    const heartbeat = join(state, ".last-watcher-beat");
    writeFileSync(heartbeat, "");
    writeFileSync(join(state, "crew.status"), "working: polishing navigation\n");
    const heartbeatTime = new Date("2026-07-26T00:00:04.000Z");
    utimesSync(heartbeat, heartbeatTime, heartbeatTime);
    const summary = projectSummariesFromDaemon(
      [
        {
          id: "prj_1",
          slug: "mandala",
          title: "Mandala",
          kind: "git",
          workspace,
          desiredState: "running",
          actualState: "running",
          tmuxTarget: "$1",
          tmuxSessionName: "firstmate-mandala",
          currentSummary: "1 live pane",
          attentionLevel: "none",
          lastHeartbeatAt: null,
          version: 3,
          createdAt: "2026-07-25T00:00:00.000Z",
          updatedAt: "2026-07-26T00:00:00.000Z",
        },
      ],
      new Date("2026-07-26T00:00:09.000Z"),
      [
        {
          id: "$1",
          name: "firstmate-mandala",
          attachedClients: 1,
          windowCount: 7,
          livePaneCount: 7,
          commands: ["claude"],
          paths: [workspace],
        },
      ],
    );
    assert.equal(summary[0]?.heartbeatSeconds, 5);
    assert.equal(summary[0]?.summary, "working: polishing navigation");
    assert.equal(
      summary[0]?.lastMessage,
      "working: polishing navigation",
    );
    assert.equal(summary[0]?.tmuxWindowCount, 7);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});
