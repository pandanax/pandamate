import assert from "node:assert/strict";
import test from "node:test";

import {
  formatElapsedTime,
  layoutForWidth,
  moveSelection,
  parseInjectedEvents,
  parseInjectedProjects,
  parseInjectedServices,
  stateGlyph,
} from "./model.ts";

test("layout breakpoints match the specification", () => {
  assert.equal(layoutForWidth(79), "compact");
  assert.equal(layoutForWidth(80), "standard");
  assert.equal(layoutForWidth(119), "standard");
  assert.equal(layoutForWidth(120), "wide");
});

test("selection wraps in both directions", () => {
  assert.equal(moveSelection(0, -1, 4), 3);
  assert.equal(moveSelection(3, 1, 4), 0);
  assert.equal(moveSelection(0, 1, 0), 0);
});

test("elapsed time is rendered as hours, minutes, and seconds", () => {
  assert.equal(formatElapsedTime(0), "00:00:00");
  assert.equal(formatElapsedTime(76), "00:01:16");
  assert.equal(formatElapsedTime(90_061), "25:01:01");
});

test("reduced motion keeps the working glyph stable", () => {
  assert.equal(stateGlyph("working", false, true), "●");
  assert.notEqual(
    stateGlyph("working", false, false),
    stateGlyph("working", true, false),
  );
});

test("injected project JSON is validated before use", () => {
  assert.deepEqual(
    parseInjectedProjects(
      JSON.stringify([
        {
          name: "firstmate",
          profile: null,
          sessionName: "firstmate",
          state: "running",
          summary: "8 live panes",
          lastMessage: null,
          heartbeatSeconds: null,
          tmuxWindowCount: 8,
        },
      ]),
    ),
    [
      {
        name: "firstmate",
        profile: null,
        sessionName: "firstmate",
        state: "running",
        summary: "8 live panes",
        lastMessage: null,
        heartbeatSeconds: null,
        tmuxWindowCount: 8,
      },
    ],
  );
  assert.throws(() => parseInjectedProjects('{"name":"unchecked"}'));
});

test("injected event journal JSON is bounded and validated", () => {
  assert.deepEqual(
    parseInjectedEvents(
      JSON.stringify([
        {
          sequence: 7,
          timestamp: "2026-07-26T12:00:00.000Z",
          type: "project.registered",
          subject: "mandala",
          detail: "Mandala · git",
        },
      ]),
    ),
    [
      {
        sequence: 7,
        timestamp: "2026-07-26T12:00:00.000Z",
        type: "project.registered",
        subject: "mandala",
        detail: "Mandala · git",
      },
    ],
  );
  assert.throws(() => parseInjectedEvents('[{"sequence":-1}]'));
});

test("injected Pandamate services are separate and validated", () => {
  assert.deepEqual(
    parseInjectedServices(
      JSON.stringify([
        {
          name: "pandamate:write",
          state: "running",
          summary: "1 live pane",
        },
      ]),
    ),
    [
      {
        name: "pandamate:write",
        state: "running",
        summary: "1 live pane",
      },
    ],
  );
  assert.throws(() =>
    parseInjectedServices(
      JSON.stringify([
        {
          name: "firstmate",
          state: "running",
          summary: "not a service",
        },
      ]),
    ),
  );
});
