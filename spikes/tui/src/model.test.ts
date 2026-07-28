import assert from "node:assert/strict";
import test from "node:test";

import {
  fleetRows,
  formatElapsedTime,
  isProjectSlug,
  layoutForWidth,
  moveSelection,
  parseInjectedEvents,
  parseInjectedProjects,
  parseInjectedServices,
  stateGlyph,
  type ProjectSummary,
} from "./model.ts";

function projectSummary(
  overrides: Partial<ProjectSummary> = {},
): ProjectSummary {
  return {
    name: "Project",
    slug: "project",
    profile: "FirstMateGit",
    sessionName: "firstmate-project",
    state: "running",
    summary: "",
    lastMessage: null,
    heartbeatSeconds: null,
    tmuxWindowCount: null,
    crew: [],
    ...overrides,
  };
}

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

test("hosted crewmates render as indented children under their project", () => {
  const rows = fleetRows([
    projectSummary({
      name: "Mandala",
      slug: "mandala",
      crew: [
        { name: "auth-fix", window: "fm-mandala-auth-fix" },
        { name: "numerology-aspect", window: "fm-mandala-numerology-aspect" },
      ],
    }),
    projectSummary({ name: "Legal", slug: "legal" }),
  ]);
  // Mandala's project row, its two crew children in order, then Legal's row.
  assert.deepEqual(
    rows.map((row) =>
      row.kind === "project"
        ? `project ${row.project.name}`
        : `${row.branch} ${row.crewmate.name}`,
    ),
    [
      "project Mandala",
      "├─ auth-fix",
      "└─ numerology-aspect",
      "project Legal",
    ],
  );
  // The crew children stay attributed to mandala (projectIndex 0), never a
  // top-level item, and never carry Legal's index.
  assert.deepEqual(
    rows.map((row) => row.projectIndex),
    [0, 0, 0, 1],
  );
  // Exactly the two projects are selectable; the crewmates are display-only.
  assert.equal(rows.filter((row) => row.kind === "project").length, 2);
  assert.equal(rows.filter((row) => row.kind === "crew").length, 2);
});

test("a project without hosted crew renders as a single row", () => {
  const rows = fleetRows([projectSummary({ name: "Solo" })]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.kind, "project");
});

test("injected project JSON is validated before use", () => {
  assert.deepEqual(
    parseInjectedProjects(
      JSON.stringify([
        {
          name: "firstmate",
          slug: null,
          profile: null,
          sessionName: "firstmate",
          state: "running",
          summary: "8 live panes",
          lastMessage: null,
          heartbeatSeconds: null,
          tmuxWindowCount: 8,
          crew: [],
        },
      ]),
    ),
    [
      {
        name: "firstmate",
        slug: null,
        profile: null,
        sessionName: "firstmate",
        state: "running",
        summary: "8 live panes",
        lastMessage: null,
        heartbeatSeconds: null,
        tmuxWindowCount: 8,
        crew: [],
      },
    ],
  );
  assert.throws(() => parseInjectedProjects('{"name":"unchecked"}'));
});

test("a project carries the crewmates it hosts as validated children", () => {
  const projects = parseInjectedProjects(
    JSON.stringify([
      {
        name: "Mandala",
        slug: "mandala",
        profile: "FirstMateGit",
        sessionName: "firstmate-mandala",
        state: "working",
        summary: "Hosting a crewmate",
        lastMessage: null,
        heartbeatSeconds: 3,
        tmuxWindowCount: 4,
        crew: [
          {
            name: "numerology-aspect",
            window: "fm-mandala-numerology-aspect",
          },
        ],
      },
    ]),
  );
  assert.deepEqual(projects[0]?.crew, [
    { name: "numerology-aspect", window: "fm-mandala-numerology-aspect" },
  ]);
  // A crew window must be an `fm-` window, and crew must be an array.
  assert.throws(() =>
    parseInjectedProjects(
      JSON.stringify([
        {
          name: "Mandala",
          slug: "mandala",
          profile: "FirstMateGit",
          sessionName: "firstmate-mandala",
          state: "working",
          summary: "",
          lastMessage: null,
          heartbeatSeconds: null,
          tmuxWindowCount: null,
          crew: [{ name: "x", window: "not-a-crew-window" }],
        },
      ]),
    ),
  );
  assert.throws(() =>
    parseInjectedProjects(
      JSON.stringify([
        {
          name: "Mandala",
          slug: "mandala",
          profile: "FirstMateGit",
          sessionName: null,
          state: "stopped",
          summary: "",
          lastMessage: null,
          heartbeatSeconds: null,
          tmuxWindowCount: null,
          crew: "nope",
        },
      ]),
    ),
  );
});

test("a Fleet item carries the durable slug it can be started again by", () => {
  const projects = parseInjectedProjects(
    JSON.stringify([
      {
        name: "Mandala",
        slug: "mandala",
        profile: "FirstMateGit",
        sessionName: null,
        state: "stopped",
        summary: "Stopped; retained in Fleet for a future start",
        lastMessage: null,
        heartbeatSeconds: null,
        tmuxWindowCount: null,
        crew: [],
      },
    ]),
  );
  assert.equal(projects[0]?.slug, "mandala");
  assert.ok(isProjectSlug("mandala"));
  for (const invalid of ["Mandala", "", "-mandala", "mandala/../etc"]) {
    assert.equal(isProjectSlug(invalid), false);
  }
  assert.throws(() =>
    parseInjectedProjects(
      JSON.stringify([
        {
          name: "Mandala",
          slug: "Not A Slug",
          profile: "FirstMateGit",
          sessionName: null,
          state: "stopped",
          summary: "",
          lastMessage: null,
          heartbeatSeconds: null,
          tmuxWindowCount: null,
          crew: [],
        },
      ]),
    ),
  );
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
