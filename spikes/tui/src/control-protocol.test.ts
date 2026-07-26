import assert from "node:assert/strict";
import test from "node:test";

import {
  parseTuiActionRequest,
  parseTuiActionResult,
  parseTuiProjectionUpdate,
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
