import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { PandamateStore } from "./index.ts";

test("persists a project and audit event across reopen", () => {
  const directory = mkdtempSync(join(tmpdir(), "pandamate-storage-"));
  const databasePath = join(directory, "state.sqlite3");
  let id = 0;
  const options = {
    now: () => new Date("2026-07-26T12:00:00.000Z"),
    createId: (prefix: "prj" | "evt" | "msg" | "chk" | "tmr" | "dec") =>
      `${prefix}_test_${++id}`,
  };
  try {
    const first = new PandamateStore(databasePath, options);
    const project = first.createProject(
      {
        slug: "mandala",
        title: "Mandala",
        kind: "git",
        workspace: "/workspace/mandala",
      },
      "test:create:mandala",
    );
    assert.equal(project.actualState, "registered");
    first.close();

    const reopened = new PandamateStore(databasePath, options);
    assert.deepEqual(reopened.listProjects(), [project]);
    assert.equal(reopened.listEvents()[0]?.type, "project.registered");
    reopened.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("replays an idempotent mutation without a duplicate event", () => {
  const store = new PandamateStore(":memory:", {
    now: () => new Date("2026-07-26T12:00:00.000Z"),
    createId: (prefix) => `${prefix}_fixed`,
  });
  try {
    const input = {
      slug: "docs",
      title: "Docs",
      kind: "docs" as const,
      workspace: "/workspace/docs",
    };
    const first = store.createProject(input, "test:create:docs");
    const replay = store.createProject(input, "test:create:docs");
    assert.deepEqual(replay, first);
    assert.equal(store.listEvents().length, 1);
  } finally {
    store.close();
  }
});

test("rejects duplicate slugs under a different command", () => {
  const store = new PandamateStore(":memory:");
  try {
    const input = {
      slug: "docs",
      title: "Docs",
      kind: "docs" as const,
      workspace: "/workspace/docs",
    };
    store.createProject(input, "test:create:docs:1");
    assert.throws(() => store.createProject(input, "test:create:docs:2"));
    assert.equal(store.listEvents().length, 1);
  } finally {
    store.close();
  }
});

test("updates desired state and event atomically", () => {
  let id = 0;
  const store = new PandamateStore(":memory:", {
    now: () => new Date("2026-07-26T12:00:00.000Z"),
    createId: (prefix) => `${prefix}_state_${++id}`,
  });
  try {
    store.createProject(
      {
        slug: "mandala",
        title: "Mandala",
        kind: "git",
        workspace: "/workspace/mandala",
      },
      "test:create:state",
    );
    const started = store.setProjectDesiredState(
      "mandala",
      "running",
      "test:start:state",
    );
    assert.equal(started.desiredState, "running");
    assert.equal(started.version, 2);
    assert.equal(
      store.listEvents().at(-1)?.type,
      "project.desired_state.changed",
    );
    assert.deepEqual(
      store.setProjectDesiredState(
        "mandala",
        "running",
        "test:start:state",
      ),
      started,
    );
    assert.equal(store.listEvents().length, 2);
  } finally {
    store.close();
  }
});

test("stores merge authority on the project", () => {
  let id = 0;
  const store = new PandamateStore(":memory:", {
    now: () => new Date("2026-08-01T12:00:00.000Z"),
    createId: (prefix) => `${prefix}_merge_${++id}`,
  });
  try {
    const project = store.createProject(
      {
        slug: "pandamate",
        title: "Pandamate",
        kind: "git",
        workspace: "/workspace/pandamate",
      },
      "test:create:merge-mode",
    );
    assert.equal(project.mergeMode, "manual");

    const automatic = store.setProjectMergeMode(
      "pandamate",
      "auto",
      "test:set:merge-mode",
    );
    assert.equal(automatic.mergeMode, "auto");
    assert.equal(automatic.version, 2);
    assert.equal(
      store.listEvents().at(-1)?.type,
      "project.merge_mode.changed",
    );
    assert.deepEqual(
      store.setProjectMergeMode(
        "pandamate",
        "auto",
        "test:set:merge-mode",
      ),
      automatic,
    );
  } finally {
    store.close();
  }
});

test("overrides and clears a project's custom display name idempotently", () => {
  let id = 0;
  const store = new PandamateStore(":memory:", {
    now: () => new Date("2026-07-26T12:00:00.000Z"),
    createId: (prefix) => `${prefix}_rename_${++id}`,
  });
  try {
    const created = store.createProject(
      {
        slug: "mandala",
        title: "Mandala",
        kind: "git",
        workspace: "/workspace/mandala",
      },
      "test:create:rename",
    );
    assert.equal(created.customDisplayName, null);

    const renamed = store.renameProject(
      "mandala",
      "My Mandala",
      "test:rename:set",
    );
    assert.equal(renamed.customDisplayName, "My Mandala");
    assert.equal(renamed.version, 2);
    assert.equal(store.getProject("mandala")?.customDisplayName, "My Mandala");
    // The real identity survives the override.
    assert.equal(store.getProject("mandala")?.title, "Mandala");
    assert.equal(store.listEvents().at(-1)?.type, "project.renamed");

    // Replaying the same idempotency key returns the same result without a
    // second version bump or a duplicate event.
    assert.deepEqual(
      store.renameProject("mandala", "My Mandala", "test:rename:set"),
      renamed,
    );
    assert.equal(store.getProject("mandala")?.version, 2);
    assert.equal(store.listEvents().length, 2);

    // An empty name clears the override back to the real title.
    const cleared = store.renameProject("mandala", "", "test:rename:clear");
    assert.equal(cleared.customDisplayName, null);
    assert.equal(cleared.version, 3);
    assert.equal(store.getProject("mandala")?.customDisplayName, null);
  } finally {
    store.close();
  }
});

test("durably adopts one live tmux target per project", () => {
  let id = 0;
  const store = new PandamateStore(":memory:", {
    now: () => new Date("2026-07-26T12:00:00.000Z"),
    createId: (prefix) => `${prefix}_adopt_${++id}`,
  });
  try {
    for (const slug of ["mandala", "docs"]) {
      store.createProject(
        {
          slug,
          title: slug,
          kind: "git",
          workspace: `/workspace/${slug}`,
        },
        `test:create:${slug}`,
      );
    }
    const adopted = store.adoptProjectTmuxSession(
      "mandala",
      "$7",
      "firstmate",
      2,
      "test:adopt:mandala",
    );
    assert.equal(adopted.tmuxTarget, "$7");
    assert.equal(adopted.desiredState, "running");
    assert.equal(adopted.actualState, "running");
    assert.equal(adopted.version, 2);
    assert.equal(
      store.listEvents().at(-1)?.type,
      "project.tmux.adopted",
    );
    assert.deepEqual(
      store.adoptProjectTmuxSession(
        "mandala",
        "$7",
        "firstmate",
        2,
        "test:adopt:mandala",
      ),
      adopted,
    );
    assert.throws(() =>
      store.adoptProjectTmuxSession(
        "docs",
        "$7",
        "firstmate",
        2,
        "test:adopt:docs",
      ),
    );
  } finally {
    store.close();
  }
});

test("leases and advances an instruction exactly through its lifecycle", () => {
  let id = 0;
  let now = new Date("2026-07-26T12:00:00.000Z");
  const store = new PandamateStore(":memory:", {
    now: () => now,
    createId: (prefix) => `${prefix}_mail_${++id}`,
  });
  try {
    store.createProject(
      {
        slug: "mandala",
        title: "Mandala",
        kind: "git",
        workspace: "/workspace/mandala",
      },
      "test:mail:project",
    );
    const queued = store.createMessage(
      {
        projectSlug: "mandala",
        text: "Finish the bounded mailbox.",
        priority: "high",
      },
      "test:mail:create",
    );
    assert.equal(queued.status, "queued");
    const leased = store.leaseMessages("mandala", "firstmate:test", 5_000, 10);
    assert.equal(leased.length, 1);
    assert.equal(leased[0]?.status, "leased");
    assert.equal(store.leaseMessages("mandala", "other", 5_000, 10).length, 0);
    assert.equal(
      store.transitionMessage(
        queued.id,
        "firstmate:test",
        "acknowledged",
        "Understood.",
      ).status,
      "acknowledged",
    );
    assert.equal(
      store.transitionMessage(
        queued.id,
        "firstmate:test",
        "applied",
        "Added to the active plan.",
      ).status,
      "applied",
    );
    assert.equal(
      store.transitionMessage(
        queued.id,
        "firstmate:test",
        "resolved",
        "Completed with tests.",
      ).status,
      "resolved",
    );
    assert.throws(() =>
      store.transitionMessage(
        queued.id,
        "firstmate:test",
        "resolved",
        "Duplicate.",
      ),
    );
    assert.deepEqual(store.listMessages("mandala"), [
      {
        ...queued,
        status: "resolved",
        leaseOwner: "firstmate:test",
        leaseExpiresAt: "2026-07-26T12:00:05.000Z",
        attempts: 1,
        acknowledgement: "Understood.",
        resolution: "Completed with tests.",
      },
    ]);
    assert.deepEqual(
      store
        .listEvents()
        .map((event) => event.type)
        .slice(-5),
      [
        "instruction.queued",
        "instruction.delivered",
        "instruction.acknowledged",
        "instruction.applied",
        "instruction.resolved",
      ],
    );
    now = new Date("2026-07-26T12:01:00.000Z");
  } finally {
    store.close();
  }
});

test("persists bounded status and checkpoints with project projection", () => {
  let id = 0;
  const store = new PandamateStore(":memory:", {
    now: () => new Date("2026-07-26T12:00:00.000Z"),
    createId: (prefix) => `${prefix}_status_${++id}`,
  });
  try {
    store.createProject(
      {
        slug: "docs",
        title: "Docs",
        kind: "docs",
        workspace: "/workspace/docs",
      },
      "test:status:project",
    );
    const checkpoint = store.createCheckpoint({
      projectSlug: "docs",
      goal: "Complete the protocol",
      phase: "verification",
      completed: ["Implemented storage"],
      pending: ["Run integration"],
      nextSafeAction: "Run the integration test",
      externalSideEffects: [],
    });
    const status = store.reportFirstMateStatus({
      projectSlug: "docs",
      state: "working",
      activity: "Running integration",
      goal: "Complete the protocol",
      progress: { kind: "steps", done: 1, total: 2 },
      iteration: 4,
      attention: "none",
      safeToInterrupt: false,
      checkpointId: checkpoint.id,
      timestamp: "2026-07-26T12:00:00.000Z",
    });
    assert.equal(status.checkpointId, checkpoint.id);
    assert.equal(store.getProject("docs")?.actualState, "working");
    assert.equal(
      store.getProject("docs")?.currentSummary,
      "Running integration",
    );
    assert.deepEqual(
      store.listEvents().map((event) => event.type).slice(-2),
      ["checkpoint.created", "firstmate.status.reported"],
    );
  } finally {
    store.close();
  }
});

test("fires a persisted timer into exactly one queued instruction", () => {
  let id = 0;
  let now = new Date("2026-07-26T12:00:00.000Z");
  const store = new PandamateStore(":memory:", {
    now: () => now,
    createId: (prefix) => `${prefix}_timer_${++id}`,
  });
  try {
    store.createProject(
      {
        slug: "mandala",
        title: "Mandala",
        kind: "git",
        workspace: "/workspace/mandala",
      },
      "test:timer:project",
    );
    const timer = store.createTimer(
      {
        projectSlug: "mandala",
        dueAt: "2026-07-26T12:01:00.000Z",
        text: "Resume the review.",
        priority: "normal",
      },
      "test:timer:create",
    );
    assert.equal(timer.status, "pending");
    assert.equal(store.fireDueTimers().length, 0);
    now = new Date("2026-07-26T12:01:00.000Z");
    const fired = store.fireDueTimers();
    assert.equal(fired.length, 1);
    assert.equal(fired[0]?.status, "fired");
    assert.equal(store.fireDueTimers().length, 0);
    assert.equal(store.listMessages("mandala").length, 1);
    assert.equal(store.listMessages("mandala")[0]?.text, "Resume the review.");
  } finally {
    store.close();
  }
});

test("deduplicates normalized hook ingestion by stable hook id", () => {
  let id = 0;
  const store = new PandamateStore(":memory:", {
    now: () => new Date("2026-07-26T12:00:01.000Z"),
    createId: (prefix) => `${prefix}_hook_${++id}`,
  });
  try {
    store.createProject(
      {
        slug: "mandala",
        title: "Mandala",
        kind: "git",
        workspace: "/workspace/mandala",
      },
      "test:hook:project",
    );
    const input = {
      projectSlug: "mandala",
      hookId: "hook-session-123",
      eventType: "agent.tool.completed",
      occurredAt: "2026-07-26T12:00:00.000Z",
      payload: { tool: "Read", durationMs: 18 },
    };
    const first = store.ingestHook(input);
    const replay = store.ingestHook(input);
    assert.deepEqual(replay, first);
    assert.equal(first.type, "hook.agent.tool.completed");
    assert.equal(
      store
        .listEvents()
        .filter((event) => event.type === "hook.agent.tool.completed").length,
      1,
    );
  } finally {
    store.close();
  }
});

test("keeps one active decision value and immutable supersession history", () => {
  let id = 0;
  const store = new PandamateStore(":memory:", {
    now: () => new Date("2026-07-26T12:00:00.000Z"),
    createId: (prefix) => `${prefix}_decision_${++id}`,
  });
  try {
    const first = store.recordDecision(
      {
        topic: "ui.motion",
        value: "full",
        summary: "Use full motion.",
        source: "Panda",
      },
      "test:decision:first",
    );
    const second = store.recordDecision(
      {
        topic: "ui.motion",
        value: "reduced",
        summary: "Use reduced motion.",
        source: "Panda",
      },
      "test:decision:second",
    );
    assert.equal(second.supersedesId, first.id);
    assert.deepEqual(store.listDecisions(), [second]);
    const history = store.listDecisions(false);
    assert.equal(history.length, 2);
    assert.equal(history[0]?.status, "superseded");
    assert.equal(history[1]?.status, "active");
  } finally {
    store.close();
  }
});
