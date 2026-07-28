export type LayoutMode = "compact" | "standard" | "wide";

/**
 * A crewmate a project's discovered crew session hosts, rendered as an indented
 * child row under the project. `window` is the `fm-<slug>-<task>` tmux window it
 * runs in; `name` is the task suffix that names it in the Fleet.
 */
export interface HostedCrewmate {
  readonly name: string;
  readonly window: string;
}

export interface ProjectSummary {
  readonly name: string;
  /**
   * The durable project this Fleet item belongs to, or null for a tmux session
   * Pandamate only discovered. It is the identity that outlives the runtime, so
   * it is the only handle a stopped item can be started again by.
   */
  readonly slug: string | null;
  readonly profile: "FirstMateArc" | "FirstMateGit" | "DocResearch" | null;
  readonly sessionName: string | null;
  readonly state:
    | "registered"
    | "starting"
    | "running"
    | "working"
    | "waiting"
    | "failed"
    | "recovering"
    | "sleeping"
    | "stopped";
  readonly summary: string;
  readonly lastMessage: string | null;
  readonly heartbeatSeconds: number | null;
  readonly tmuxWindowCount: number | null;
  /**
   * Crewmates a discovered crew session hosts for this project, drawn as
   * indented child rows beneath it. Empty for a project with no folded-in crew
   * session, which is every project by default.
   */
  readonly crew: readonly HostedCrewmate[];
}

export interface ServiceSummary {
  readonly name: string;
  readonly state: "running" | "stopped";
  readonly summary: string;
}

export interface DeckModel {
  readonly projects: readonly ProjectSummary[];
  readonly services: readonly ServiceSummary[];
  readonly selectedIndex: number;
  readonly reducedMotion: boolean;
  readonly pulseOn: boolean;
}

export interface EventSummary {
  readonly sequence: number;
  readonly timestamp: string;
  readonly type: string;
  readonly subject: string;
  readonly detail: string;
}

export const demoProjects: readonly ProjectSummary[] = [
  {
    name: "Mandala",
    slug: "mandala",
    profile: "FirstMateGit",
    sessionName: null,
    state: "working",
    summary: "Fixing mobile authentication",
    lastMessage: "working: fixing mobile authentication",
    heartbeatSeconds: 4,
    tmuxWindowCount: 6,
    crew: [
      { name: "numerology-aspect", window: "fm-mandala-numerology-aspect" },
    ],
  },
  {
    name: "ARC-1234",
    slug: "arc-1234",
    profile: "FirstMateArc",
    sessionName: null,
    state: "waiting",
    summary: "Needs a product decision",
    lastMessage: "needs-decision: choose the rollout cohort",
    heartbeatSeconds: 18,
    tmuxWindowCount: 3,
    crew: [],
  },
  {
    name: "Legal",
    slug: "legal",
    profile: "DocResearch",
    sessionName: null,
    state: "sleeping",
    summary: "Waiting for the next review window",
    lastMessage: null,
    heartbeatSeconds: null,
    tmuxWindowCount: null,
    crew: [],
  },
  {
    name: "Personal site",
    slug: "personal-site",
    profile: "FirstMateGit",
    sessionName: null,
    state: "stopped",
    summary: "Stopped by Panda",
    lastMessage: "done: stopped by Panda",
    heartbeatSeconds: null,
    tmuxWindowCount: null,
    crew: [],
  },
];

export const emptyProject: ProjectSummary = {
  name: "No supervised sessions",
  slug: null,
  profile: null,
  sessionName: null,
  state: "stopped",
  summary: "Start or adopt a tmux project session to populate the Fleet.",
  lastMessage: null,
  heartbeatSeconds: null,
  tmuxWindowCount: null,
  crew: [],
};

const projectStates = new Set<ProjectSummary["state"]>([
  "registered",
  "starting",
  "running",
  "working",
  "waiting",
  "failed",
  "recovering",
  "sleeping",
  "stopped",
]);

/**
 * The same shape `@pandamate/runtime-tmux` validates project slugs against.
 * The TUI runs as its own process without workspace dependencies, so the rule
 * is restated here rather than imported.
 */
const projectSlugPattern = /^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/;

export function isProjectSlug(value: unknown): value is string {
  return typeof value === "string" && projectSlugPattern.test(value);
}

function isHostedCrewmate(value: unknown): value is HostedCrewmate {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.name === "string" &&
    candidate.name.length > 0 &&
    candidate.name.length <= 80 &&
    typeof candidate.window === "string" &&
    candidate.window.startsWith("fm-") &&
    candidate.window.length > 0 &&
    candidate.window.length <= 96
  );
}

function isProjectSummary(value: unknown): value is ProjectSummary {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.name === "string" &&
    candidate.name.length > 0 &&
    candidate.name.length <= 80 &&
    (candidate.slug === null || isProjectSlug(candidate.slug)) &&
    (candidate.profile === null ||
      candidate.profile === "FirstMateArc" ||
      candidate.profile === "FirstMateGit" ||
      candidate.profile === "DocResearch") &&
    (candidate.sessionName === null ||
      (typeof candidate.sessionName === "string" &&
        candidate.sessionName.length > 0 &&
        candidate.sessionName.length <= 80 &&
        candidate.sessionName !== "pandamate:home" &&
        candidate.sessionName !== "pandamate:idle-probe" &&
        candidate.sessionName !== "pandamate:probe-keeper" &&
        !candidate.sessionName.startsWith("pandamate:control-"))) &&
    typeof candidate.state === "string" &&
    projectStates.has(candidate.state as ProjectSummary["state"]) &&
    typeof candidate.summary === "string" &&
    candidate.summary.length <= 240 &&
    (candidate.lastMessage === null ||
      (typeof candidate.lastMessage === "string" &&
        candidate.lastMessage.length > 0 &&
        candidate.lastMessage.length <= 240)) &&
    (candidate.heartbeatSeconds === null ||
      (typeof candidate.heartbeatSeconds === "number" &&
        Number.isFinite(candidate.heartbeatSeconds) &&
        candidate.heartbeatSeconds >= 0)) &&
    (candidate.tmuxWindowCount === null ||
      (typeof candidate.tmuxWindowCount === "number" &&
        Number.isSafeInteger(candidate.tmuxWindowCount) &&
        candidate.tmuxWindowCount >= 0 &&
        candidate.tmuxWindowCount <= 1_000)) &&
    Array.isArray(candidate.crew) &&
    candidate.crew.length <= 100 &&
    candidate.crew.every(isHostedCrewmate)
  );
}

export function parseInjectedProjects(raw: string): readonly ProjectSummary[] {
  const parsed: unknown = JSON.parse(raw);
  if (
    !Array.isArray(parsed) ||
    parsed.length > 100 ||
    !parsed.every(isProjectSummary)
  ) {
    throw new Error("Invalid PANDAMATE_PROJECTS_JSON payload");
  }
  return parsed;
}

function isServiceSummary(value: unknown): value is ServiceSummary {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.name === "string" &&
    candidate.name.startsWith("pandamate:") &&
    candidate.name.length <= 80 &&
    (candidate.state === "running" || candidate.state === "stopped") &&
    typeof candidate.summary === "string" &&
    candidate.summary.length <= 240
  );
}

export function parseInjectedServices(
  raw: string,
): readonly ServiceSummary[] {
  const parsed: unknown = JSON.parse(raw);
  if (
    !Array.isArray(parsed) ||
    parsed.length > 50 ||
    !parsed.every(isServiceSummary)
  ) {
    throw new Error("Invalid PANDAMATE_SERVICES_JSON payload");
  }
  return parsed;
}

function isEventSummary(value: unknown): value is EventSummary {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.sequence === "number" &&
    Number.isSafeInteger(candidate.sequence) &&
    candidate.sequence > 0 &&
    typeof candidate.timestamp === "string" &&
    candidate.timestamp.length > 0 &&
    candidate.timestamp.length <= 40 &&
    typeof candidate.type === "string" &&
    candidate.type.length > 0 &&
    candidate.type.length <= 80 &&
    typeof candidate.subject === "string" &&
    candidate.subject.length > 0 &&
    candidate.subject.length <= 120 &&
    typeof candidate.detail === "string" &&
    candidate.detail.length <= 240
  );
}

export function parseInjectedEvents(raw: string): readonly EventSummary[] {
  const parsed: unknown = JSON.parse(raw);
  if (
    !Array.isArray(parsed) ||
    parsed.length > 500 ||
    !parsed.every(isEventSummary)
  ) {
    throw new Error("Invalid PANDAMATE_EVENTS_JSON payload");
  }
  return parsed;
}

/**
 * One drawable Fleet row. A `project` row is a selectable top-level item; a
 * `crew` row is a display-only child of the project at `projectIndex`, indented
 * beneath it. Rendering maps this list 1:1 to boxes, so the nesting — and which
 * rows are selectable — is decided here and testable without the renderer.
 */
export type FleetRow =
  | {
      readonly kind: "project";
      readonly projectIndex: number;
      readonly project: ProjectSummary;
    }
  | {
      readonly kind: "crew";
      readonly projectIndex: number;
      readonly crewmate: HostedCrewmate;
      /** The tree glyph: `└─` for the last child, `├─` otherwise. */
      readonly branch: "├─" | "└─";
    };

/**
 * Flatten the Fleet into project rows each immediately followed by its hosted
 * crewmates as indented children. Selection stays keyed on `projectIndex`, so a
 * crew row never becomes an independently selectable item — it renders under its
 * project and shares that project's selection.
 */
export function fleetRows(
  projects: readonly ProjectSummary[],
): readonly FleetRow[] {
  return projects.flatMap((project, projectIndex) => [
    { kind: "project" as const, projectIndex, project },
    ...project.crew.map((crewmate, crewIndex) => ({
      kind: "crew" as const,
      projectIndex,
      crewmate,
      branch: (crewIndex === project.crew.length - 1 ? "└─" : "├─") as
        | "├─"
        | "└─",
    })),
  ]);
}

export function layoutForWidth(width: number): LayoutMode {
  if (width >= 120) {
    return "wide";
  }
  if (width >= 80) {
    return "standard";
  }
  return "compact";
}

export function moveSelection(
  current: number,
  direction: -1 | 1,
  itemCount: number,
): number {
  if (itemCount <= 0) {
    return 0;
  }
  return (current + direction + itemCount) % itemCount;
}

export function formatElapsedTime(seconds: number): string {
  const wholeSeconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(wholeSeconds / 3_600);
  const minutes = Math.floor((wholeSeconds % 3_600) / 60);
  const remainingSeconds = wholeSeconds % 60;
  return [hours, minutes, remainingSeconds]
    .map((value) => String(value).padStart(2, "0"))
    .join(":");
}

export function stateGlyph(
  state: ProjectSummary["state"],
  pulseOn: boolean,
  reducedMotion: boolean,
): string {
  switch (state) {
    case "registered":
      return "○";
    case "starting":
    case "recovering":
      return reducedMotion || pulseOn ? "◉" : "○";
    case "running":
      return "●";
    case "working":
      return reducedMotion || pulseOn ? "●" : "◉";
    case "waiting":
      return "◉";
    case "failed":
      return "×";
    case "sleeping":
      return "◌";
    case "stopped":
      return "○";
  }
}
