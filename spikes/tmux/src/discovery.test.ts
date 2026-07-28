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
  hostedCrewByProjectSlug,
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
        windowNames: ["zsh"],
      },
      {
        id: "$2",
        name: "pandamate:home",
        attachedClients: 1,
        windowCount: 1,
        livePaneCount: 1,
        commands: ["node"],
        paths: ["/pandamate"],
        windowNames: ["home"],
      },
    ]),
    [
      {
        name: "firstmate",
        slug: null,
        profile: null,
        sessionName: "firstmate",
        state: "running",
        summary: "8 windows · 8 live panes · 2.1.159, zsh",
        lastMessage: null,
        heartbeatSeconds: null,
        tmuxWindowCount: 8,
        crew: [],
      },
    ],
  );
});

test("a bare firstmate crew session is folded into its parent project", () => {
  // The session named `firstmate` hosts a mandala crewmate — window
  // `fm-mandala-numerology-aspect` — so with mandala registered it belongs to
  // mandala's row, not to itself as a separate nameless FirstMate.
  assert.deepEqual(
    projectSummariesFromTmux(
      [
        {
          id: "$1",
          name: "firstmate",
          attachedClients: 0,
          windowCount: 2,
          livePaneCount: 2,
          commands: ["claude", "zsh"],
          paths: ["/Users/pandanax/dev/mandala"],
          windowNames: ["fm-mandala-numerology-aspect", "zsh"],
        },
      ],
      new Set(["mandala"]),
    ),
    [],
  );
});

test("a folded crew session's crewmate is attributed to its project as a child", () => {
  const sessions = [
    {
      id: "$1",
      name: "firstmate",
      attachedClients: 0,
      windowCount: 2,
      livePaneCount: 2,
      commands: ["claude", "zsh"],
      paths: ["/Users/pandanax/dev/mandala"],
      windowNames: ["fm-mandala-numerology-aspect", "zsh"],
    },
  ];
  const knownSlugs = new Set(["mandala"]);
  // The crew session is dropped from the standalone Fleet …
  assert.deepEqual(projectSummariesFromTmux(sessions, knownSlugs), []);
  // … and its crewmate reappears keyed under mandala.
  const hosted = hostedCrewByProjectSlug(sessions, knownSlugs);
  assert.deepEqual(hosted.get("mandala"), [
    { name: "numerology-aspect", window: "fm-mandala-numerology-aspect" },
  ]);

  // The project row carries that crewmate as a child, not as a top-level item.
  const summaries = projectSummariesFromDaemon(
    [
      {
        id: "prj_1",
        slug: "mandala",
        title: "Mandala",
        customDisplayName: null,
        kind: "git",
        workspace: "/workspace/mandala",
        desiredState: "running",
        actualState: "running",
        tmuxTarget: "$9",
        tmuxSessionName: "firstmate-mandala",
        currentSummary: "1 live pane",
        attentionLevel: "none",
        lastHeartbeatAt: "2026-07-26T00:00:00.000Z",
        version: 3,
        createdAt: "2026-07-25T00:00:00.000Z",
        updatedAt: "2026-07-26T00:00:00.000Z",
      },
    ],
    new Date("2026-07-26T00:00:05.000Z"),
    [],
    hosted,
  );
  assert.equal(summaries.length, 1);
  assert.equal(summaries[0]?.name, "Mandala");
  assert.deepEqual(summaries[0]?.crew, [
    { name: "numerology-aspect", window: "fm-mandala-numerology-aspect" },
  ]);
});

test("an ambiguous two-project crew session hosts no children", () => {
  const sessions = [
    {
      id: "$1",
      name: "firstmate",
      attachedClients: 0,
      windowCount: 3,
      livePaneCount: 3,
      commands: ["claude"],
      paths: ["/workspace"],
      windowNames: ["fm-mandala-a", "fm-monomarket-b", "zsh"],
    },
  ];
  const knownSlugs = new Set(["mandala", "monomarket"]);
  // It stays its own standalone item …
  const standalone = projectSummariesFromTmux(sessions, knownSlugs);
  assert.equal(standalone.length, 1);
  assert.equal(standalone[0]?.name, "firstmate");
  assert.deepEqual(standalone[0]?.crew, []);
  // … and folds no crewmate under either project.
  const hosted = hostedCrewByProjectSlug(sessions, knownSlugs);
  assert.equal(hosted.get("mandala"), undefined);
  assert.equal(hosted.get("monomarket"), undefined);
});

test("a project's own firstmate session is never a crew host", () => {
  // `firstmate-mandala` is the FirstMate itself; its windows are not crew
  // windows, so it contributes no child crew even though mandala is registered.
  const hosted = hostedCrewByProjectSlug(
    [
      {
        id: "$1",
        name: "firstmate-mandala",
        attachedClients: 1,
        windowCount: 2,
        livePaneCount: 2,
        commands: ["claude"],
        paths: ["/workspace/mandala"],
        windowNames: ["mandala", "watch"],
      },
    ],
    new Set(["mandala"]),
  );
  assert.equal(hosted.size, 0);
});

test("a crew session for an unregistered project contributes no child crew", () => {
  const hosted = hostedCrewByProjectSlug(
    [
      {
        id: "$1",
        name: "firstmate",
        attachedClients: 0,
        windowCount: 2,
        livePaneCount: 2,
        commands: ["claude", "zsh"],
        paths: ["/Users/pandanax/dev/mandala"],
        windowNames: ["fm-mandala-numerology-aspect", "zsh"],
      },
    ],
    new Set(["pandamate", "monomarket"]),
  );
  assert.equal(hosted.size, 0);
});

test("a crew session for an unregistered project stays its own item", () => {
  // Nothing to fold it into: mandala is not registered, so the crew session is
  // still surfaced rather than silently vanishing.
  const summaries = projectSummariesFromTmux(
    [
      {
        id: "$1",
        name: "firstmate",
        attachedClients: 0,
        windowCount: 2,
        livePaneCount: 2,
        commands: ["claude", "zsh"],
        paths: ["/Users/pandanax/dev/mandala"],
        windowNames: ["fm-mandala-numerology-aspect", "zsh"],
      },
    ],
    new Set(["pandamate", "monomarket"]),
  );
  assert.equal(summaries.length, 1);
  assert.equal(summaries[0]?.name, "firstmate");
});

test("a genuinely unrelated session is still its own Fleet item", () => {
  const summaries = projectSummariesFromTmux(
    [
      {
        id: "$1",
        name: "scratch",
        attachedClients: 1,
        windowCount: 1,
        livePaneCount: 1,
        commands: ["vim"],
        paths: ["/tmp"],
        windowNames: ["editor"],
      },
    ],
    new Set(["mandala"]),
  );
  assert.equal(summaries.length, 1);
  assert.equal(summaries[0]?.name, "scratch");
  assert.equal(summaries[0]?.slug, null);
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
        windowNames: ["write"],
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
        windowNames: ["write"],
      },
      {
        id: "$3",
        name: "firstmate-mandala",
        attachedClients: 0,
        windowCount: 2,
        livePaneCount: 2,
        commands: ["node"],
        paths: ["/workspace/mandala"],
        windowNames: ["mandala", "watch"],
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
        customDisplayName: null,
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
  // The runtime is gone, so the slug is the only handle left to start it by.
  assert.equal(summary[0]?.slug, "mandala");
});

test("Fleet shows a project's custom display name over its real title", () => {
  const base = {
    id: "prj_1",
    slug: "mandala",
    title: "Mandala",
    kind: "git" as const,
    workspace: "/workspace/mandala",
    desiredState: "stopped" as const,
    actualState: "stopped" as const,
    tmuxTarget: null,
    tmuxSessionName: null,
    currentSummary: "Stopped",
    attentionLevel: "none" as const,
    lastHeartbeatAt: null,
    version: 3,
    createdAt: "2026-07-25T00:00:00.000Z",
    updatedAt: "2026-07-26T00:00:00.000Z",
  };
  // A null override falls back to the real title.
  const withTitle = projectSummariesFromDaemon(
    [{ ...base, customDisplayName: null }],
    new Date("2026-07-26T00:00:05.000Z"),
  );
  assert.equal(withTitle[0]?.name, "Mandala");
  // A set override wins, without disturbing the slug identity.
  const withOverride = projectSummariesFromDaemon(
    [{ ...base, customDisplayName: "My Mandala" }],
    new Date("2026-07-26T00:00:05.000Z"),
  );
  assert.equal(withOverride[0]?.name, "My Mandala");
  assert.equal(withOverride[0]?.slug, "mandala");
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
          customDisplayName: null,
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
          windowNames: ["mandala", "watch"],
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
