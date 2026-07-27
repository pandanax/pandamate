import assert from "node:assert/strict";
import test from "node:test";

import {
  parseTuiActionRequest,
  parseTuiActionResult,
  parseTuiProjectionUpdate,
  parseTuiShutdownProgress,
} from "./control-protocol.ts";

test("control protocol rejects Pandamate control-plane targets", () => {
  assert.throws(() =>
    parseTuiActionRequest({
      type: "action.request",
      action: "session.kill",
      sessionName: "pandamate:home",
    }),
  );
});

test("control protocol accepts bounded project actions and results", () => {
  const open = parseTuiActionRequest({
    type: "action.request",
    action: "session.open",
    sessionName: "firstmate",
  });
  assert.equal(open.action, "session.open");
  assert.ok("sessionName" in open);
  assert.equal(open.sessionName, "firstmate");
  assert.equal(
    parseTuiActionResult({
      type: "action.result",
      action: "session.open",
      sessionName: "firstmate",
      success: true,
      message: "Opened firstmate",
    }).success,
    true,
  );
  assert.equal(
    parseTuiActionRequest({
      type: "action.request",
      action: "session.graceful-shutdown",
      sessionName: "firstmate",
    }).action,
    "session.graceful-shutdown",
  );
  assert.equal(
    parseTuiActionRequest({
      type: "action.request",
      action: "session.reset",
      sessionName: "firstmate",
    }).action,
    "session.reset",
  );
});

test("starting a stopped FirstMate travels by slug, not by session", () => {
  assert.deepEqual(
    parseTuiActionRequest({
      type: "action.request",
      action: "project.start",
      slug: "mandala",
    }),
    { type: "action.request", action: "project.start", slug: "mandala" },
  );
  // A stopped project has no session, so a start request must not be
  // rejected for missing one — and must not be accepted without a valid slug.
  for (const invalid of [
    { type: "action.request", action: "project.start" },
    { type: "action.request", action: "project.start", slug: "Mandala" },
    { type: "action.request", action: "project.start", slug: "../etc" },
    {
      type: "action.request",
      action: "project.start",
      sessionName: "firstmate-mandala",
    },
  ]) {
    assert.throws(() => parseTuiActionRequest(invalid));
  }
  assert.deepEqual(
    parseTuiActionResult({
      type: "action.result",
      action: "project.start",
      slug: "mandala",
      success: true,
      message: "Starting mandala again.",
    }),
    {
      type: "action.result",
      action: "project.start",
      slug: "mandala",
      success: true,
      message: "Starting mandala again.",
    },
  );
  assert.throws(() =>
    parseTuiActionResult({
      type: "action.result",
      action: "project.start",
      success: true,
      message: "Starting an unnamed project.",
    }),
  );
});

test("control protocol accepts bounded Pandamate input", () => {
  assert.deepEqual(
    parseTuiActionRequest({
      type: "action.request",
      action: "pandamate.submit",
      text: 'Создай FirstMateGit "/workspace/site"',
    }),
    {
      type: "action.request",
      action: "pandamate.submit",
      text: 'Создай FirstMateGit "/workspace/site"',
    },
  );
  assert.throws(() =>
    parseTuiActionRequest({
      type: "action.request",
      action: "pandamate.submit",
      text: "",
    }),
  );
});

test("control protocol validates live projection updates", () => {
  const update = parseTuiProjectionUpdate({
    type: "projection.update",
    projects: [
      {
        name: "Docs",
        slug: "docs",
        profile: "DocResearch",
        sessionName: "firstmate-docs",
        state: "starting",
        summary: "FirstMate is starting.",
        lastMessage: null,
        heartbeatSeconds: null,
        tmuxWindowCount: 1,
      },
    ],
    services: [
      {
        name: "pandamate:write",
        state: "running",
        summary: "1 windows · 1 live panes · 1 attached",
      },
    ],
    events: [
      {
        sequence: 7,
        timestamp: "2026-07-26T00:00:00.000Z",
        type: "project.start.requested",
        subject: "docs",
        detail: "FirstMateGit",
      },
    ],
  });

  assert.equal(update.projects[0]?.state, "starting");
  assert.equal(update.services[0]?.name, "pandamate:write");
  assert.equal(update.events[0]?.sequence, 7);
  assert.throws(() =>
    parseTuiProjectionUpdate({
      type: "projection.update",
      projects: [{ name: "unvalidated" }],
      services: [],
      events: [],
    }),
  );
});

test("a full shutdown is requested without a session and carries no target", () => {
  assert.deepEqual(
    parseTuiActionRequest({
      type: "action.request",
      action: "pandamate.shutdown-all",
    }),
    { type: "action.request", action: "pandamate.shutdown-all" },
  );
  assert.deepEqual(
    parseTuiActionResult({
      type: "action.result",
      action: "pandamate.shutdown-all",
      success: false,
      message: "Pandamate could not close itself.",
    }),
    {
      type: "action.result",
      action: "pandamate.shutdown-all",
      success: false,
      message: "Pandamate could not close itself.",
    },
  );
});

test("shutdown progress is validated before it reaches the screen", () => {
  const progress = parseTuiShutdownProgress({
    type: "shutdown.progress",
    phase: "firstmates",
    headline: "Waiting for 1 FirstMate to finish…",
    sessions: [
      {
        session: "firstmate-mandala",
        outcome: "requested",
        detail: "Shutdown sent to window 0 ($1:@2.%3)",
      },
    ],
    foreign: ["work"],
  });
  assert.equal(progress.phase, "firstmates");
  assert.equal(progress.sessions[0]?.outcome, "requested");
  assert.deepEqual(progress.foreign, ["work"]);

  for (const invalid of [
    { type: "shutdown.progress", phase: "unknown", headline: "", sessions: [], foreign: [] },
    {
      type: "shutdown.progress",
      phase: "closed",
      headline: "done",
      sessions: [{ session: "firstmate-mandala", outcome: "vanished", detail: "" }],
      foreign: [],
    },
    { type: "shutdown.progress", phase: "closed", headline: "done", sessions: [], foreign: [42] },
  ]) {
    assert.throws(() => parseTuiShutdownProgress(invalid));
  }
});
