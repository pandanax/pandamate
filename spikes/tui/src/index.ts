import {
  Box,
  Text,
  createCliRenderer,
  type CliRenderer,
} from "@opentui/core";

import {
  demoProjects,
  emptyProject,
  formatElapsedTime,
  layoutForWidth,
  moveSelection,
  parseInjectedEvents,
  parseInjectedProjects,
  parseInjectedServices,
  stateGlyph,
  type DeckModel,
  type EventSummary,
  type ProjectSummary,
  type ServiceSummary,
} from "./model.ts";
import {
  parseTuiActionResult,
  parseTuiProjectionUpdate,
  parseTuiShutdownProgress,
  type SessionTuiAction,
  type TuiActionRequest,
  type TuiShutdownProgress,
} from "./control-protocol.ts";

type Screen =
  | "home"
  | "input"
  | "events"
  | "services"
  | "project"
  | "confirm-graceful"
  | "confirm-reset"
  | "confirm-kill"
  | "confirm-shutdown-all"
  | "shutdown";

const colors = {
  graphite: "#111417",
  panel: "#191E22",
  softWhite: "#E8E6DF",
  muted: "#8C969E",
  bamboo: "#77B255",
  amber: "#E6AD45",
  coral: "#F07167",
  cyan: "#62D8E8",
  purple: "#B6A0FF",
  border: "#354048",
} as const;

function stateColor(state: ProjectSummary["state"]): string {
  switch (state) {
    case "registered":
      return colors.muted;
    case "starting":
    case "recovering":
      return colors.purple;
    case "running":
      return colors.cyan;
    case "working":
      return colors.bamboo;
    case "waiting":
      return colors.amber;
    case "failed":
      return colors.coral;
    case "sleeping":
      return colors.purple;
    case "stopped":
      return colors.muted;
  }
}

function selectedProject(model: DeckModel): ProjectSummary {
  return model.projects[model.selectedIndex] ?? emptyProject;
}

function fleetPanel(model: DeckModel, onSelect: (index: number) => void) {
  return Box(
    {
      id: "fleet-panel",
      title: " FLEET ",
      borderStyle: "rounded",
      borderColor: colors.border,
      backgroundColor: colors.panel,
      flexDirection: "column",
      flexGrow: 1,
      minWidth: 28,
      padding: 1,
    },
    ...model.projects.map((project, index) =>
      Box(
        {
          id: `project-${index}`,
          height: 1,
          flexDirection: "row",
          backgroundColor:
            index === model.selectedIndex ? "#263139" : colors.panel,
          onMouseDown: () => onSelect(index),
        },
        Text({
          content: `${index === model.selectedIndex ? "›" : " "} ${stateGlyph(project.state, model.pulseOn, model.reducedMotion)} `,
          fg: stateColor(project.state),
          width: 4,
        }),
        Text({
          content: project.name,
          fg: colors.softWhite,
          flexGrow: 1,
        }),
        ...(project.profile
          ? [
              Text({
                content: ` ${project.profile}  `,
                fg: colors.cyan,
              }),
            ]
          : []),
        Text({
          content: project.state,
          fg: stateColor(project.state),
        }),
      ),
    ),
  );
}

function detailPanel(project: ProjectSummary) {
  const heartbeat =
    project.heartbeatSeconds === null
      ? "heartbeat unavailable"
      : `heartbeat ${formatElapsedTime(project.heartbeatSeconds)} ago`;

  return Box(
    {
      id: "detail-panel",
      title: ` SELECTED: ${project.name.toUpperCase()} `,
      borderStyle: "rounded",
      borderColor: colors.border,
      backgroundColor: colors.panel,
      flexDirection: "column",
      flexGrow: 2,
      minWidth: 34,
      padding: 1,
      gap: 1,
    },
    Text({
      content: `profile: ${project.profile ?? "unclassified"}`,
      fg: project.profile ? colors.cyan : colors.muted,
    }),
    Text({
      content: `status: ${project.state}`,
      fg: stateColor(project.state),
    }),
    Text({
      content: `tmux tabs: ${project.tmuxWindowCount ?? "unavailable"}`,
      fg:
        project.tmuxWindowCount === null
          ? colors.muted
          : colors.softWhite,
    }),
    Text({ content: heartbeat, fg: colors.muted }),
    Text({
      content: `last message: ${project.lastMessage ?? "not reported yet"}`,
      fg: project.lastMessage ? colors.softWhite : colors.muted,
    }),
  );
}

function activityPanel(events: readonly EventSummary[]) {
  const latest = events.at(-1);
  return Box(
    {
      id: "activity-panel",
      title: " LIVE ACTIVITY ",
      borderStyle: "rounded",
      borderColor: colors.border,
      backgroundColor: colors.panel,
      flexDirection: "column",
      flexGrow: 1,
      padding: 1,
    },
    Text({
      content: latest
        ? `#${latest.sequence}  ${latest.type}  ${latest.subject}`
        : "No durable events recorded yet",
      fg: latest ? colors.softWhite : colors.muted,
    }),
    Text({ content: "[e] Open event journal", fg: colors.cyan }),
  );
}

function servicesPanel(
  services: readonly ServiceSummary[],
  condensed = false,
) {
  const serviceRows =
    services.length === 0
      ? [Text({ content: "No service sessions detected", fg: colors.muted })]
      : condensed
        ? [
            Text({
              content: services
                .map(
                  (service) =>
                    `${service.state === "running" ? "●" : "○"} ${service.name.replace("pandamate:", "")}`,
                )
                .join("   ·   "),
              fg: colors.purple,
            }),
          ]
        : services.map((service) =>
            Text({
              content: `${service.state === "running" ? "●" : "○"} ${service.name.replace("pandamate:", "")}  ·  ${service.summary}`,
              fg:
                service.state === "running"
                  ? colors.purple
                  : colors.muted,
            }),
          );
  return Box(
    {
      id: "services-panel",
      title: " PANDAMATE SERVICES ",
      borderStyle: "rounded",
      borderColor: colors.purple,
      backgroundColor: colors.panel,
      flexDirection: "column",
      flexGrow: 1,
      padding: 1,
    },
    ...serviceRows,
    Text({ content: "[s] Open services", fg: colors.cyan }),
  );
}

function header(model: DeckModel, mode: string) {
  const active = model.projects.filter(
    (project) => project.state === "working" || project.state === "running",
  ).length;
  const waiting = model.projects.filter((project) => project.state === "waiting").length;
  const runningServices = model.services.filter(
    (service) => service.state === "running",
  ).length;
  return Box(
    {
      id: "header",
      height: 4,
      borderStyle: "rounded",
      borderColor: colors.cyan,
      backgroundColor: colors.panel,
      flexDirection: "column",
      paddingLeft: 1,
      paddingRight: 1,
    },
    Text({
      content: `🐼 PANDAMATE  ·  ${mode.toUpperCase()}  ·  ${model.reducedMotion ? "REDUCED MOTION" : "LIVE"}`,
      fg: colors.softWhite,
    }),
    Text({
      content:
        mode === "compact"
          ? `FLEET ●${active} ◉${waiting} ○${model.projects.length - active - waiting}  ·  SERVICES ${runningServices}/${model.services.length}`
          : `FLEET  ● ${active} ACTIVE   ◉ ${waiting} WAITING   ○ ${model.projects.length - active - waiting} INACTIVE   ·   SERVICES ${runningServices}/${model.services.length}`,
      fg: colors.bamboo,
    }),
  );
}

function footer(screen: Screen, message: string | null) {
  const help =
    screen === "home"
      ? "i write · s services · ↑↓/jk select · Enter project · e events · R reload · X close all · q quit"
      : screen === "confirm-shutdown-all"
        ? "y close all of Pandamate · n/Esc cancel"
      : screen === "shutdown"
        ? "Pandamate is closing itself down…"
      : screen === "input"
        ? "Enter send · ask anything or paste/drag a project folder · Esc cancel"
      : screen === "events"
        ? "↑↓/jk scroll · Esc back home · R reload · q quit"
      : screen === "services"
        ? "Pandamate control plane · Esc back home · R reload · q quit"
      : screen === "project"
        ? "o open · g graceful · r reset · x kill · Esc back · R reload · q quit"
        : screen === "confirm-graceful"
          ? "y confirm graceful shutdown · n/Esc cancel · q quit"
          : screen === "confirm-reset"
            ? "y confirm reset · n/Esc cancel · q quit"
            : "y confirm kill · n/Esc cancel · q quit";
  return Box(
    {
      id: "footer",
      height: message ? 4 : 3,
      borderStyle: "rounded",
      borderColor: colors.purple,
      backgroundColor: colors.panel,
      paddingLeft: 1,
      paddingRight: 1,
      flexDirection: "column",
    },
    ...(message
      ? [
          Text({
            content: message,
            fg: colors.amber,
          }),
        ]
      : []),
    Text({
      content: help,
      fg: colors.muted,
    }),
  );
}

function pandamateInputPanel(value: string) {
  return Box(
    {
      id: "pandamate-input",
      title: " WRITE TO PANDAMATE ",
      borderStyle: "double",
      borderColor: colors.purple,
      backgroundColor: colors.panel,
      flexDirection: "column",
      flexGrow: 1,
      padding: 2,
      gap: 2,
    },
    Text({
      content:
        "Ask Pandamate about the Fleet, or create a project with a profile and absolute folder:",
      fg: colors.softWhite,
    }),
    Text({
      content:
        'Кому я нужен?  ·  Создай FirstMateGit "/absolute/path"  ·  FirstMateArc  ·  DocResearch',
      fg: colors.cyan,
    }),
    Box(
      {
        title: " INPUT ",
        borderStyle: "rounded",
        borderColor: colors.cyan,
        height: 3,
        paddingLeft: 1,
        paddingRight: 1,
      },
      Text({
        content: `› ${value}█`,
        fg: colors.softWhite,
      }),
    ),
  );
}

function eventJournalPanel(
  events: readonly EventSummary[],
  selectedEventIndex: number,
) {
  const visible = events.slice(
    Math.max(0, selectedEventIndex - 12),
    Math.max(0, selectedEventIndex - 12) + 18,
  );
  return Box(
    {
      id: "event-journal",
      title: " EVENT JOURNAL ",
      borderStyle: "rounded",
      borderColor: colors.cyan,
      backgroundColor: colors.panel,
      flexDirection: "column",
      flexGrow: 1,
      padding: 1,
      gap: 1,
    },
    ...(visible.length === 0
      ? [
          Text({
            content:
              "No durable events yet. Start the daemon and register a project.",
            fg: colors.muted,
          }),
        ]
      : visible.map((event) => {
          const index = events.indexOf(event);
          const selected = index === selectedEventIndex;
          return Box(
            {
              id: `event-${event.sequence}`,
              height: 2,
              flexDirection: "column",
              backgroundColor: selected ? "#263139" : colors.panel,
            },
            Text({
              content: `${selected ? "›" : " "} #${event.sequence}  ${event.timestamp.slice(11, 19)}  ${event.type}  ·  ${event.subject}`,
              fg: selected ? colors.cyan : colors.softWhite,
            }),
            Text({ content: `    ${event.detail}`, fg: colors.muted }),
          );
        })),
  );
}

function shutdownConfirmPanel(model: DeckModel) {
  const live = model.projects.filter(
    (project) => project.sessionName !== null,
  ).length;
  const services = model.services.filter(
    (service) => service.state === "running",
  ).length;
  return Box(
    {
      id: "confirm-shutdown-all",
      title: " CONFIRM FULL PANDAMATE SHUTDOWN ",
      borderStyle: "double",
      borderColor: colors.coral,
      backgroundColor: colors.panel,
      flexDirection: "column",
      flexGrow: 1,
      padding: 2,
      gap: 1,
    },
    Text({
      content: `Close everything: ${live} live FirstMate${live === 1 ? "" : "s"} and ${services} Pandamate service${services === 1 ? "" : "s"}.`,
      fg: colors.coral,
    }),
    Text({
      content:
        "1. Every FirstMate is asked to shut down gracefully — crew dismissed,",
      fg: colors.softWhite,
    }),
    Text({
      content:
        "   worktrees released, Arcadia workspaces unmounted, state saved.",
      fg: colors.softWhite,
    }),
    Text({
      content: "2. Pandamate waits for each one, then stops the daemon.",
      fg: colors.softWhite,
    }),
    Text({
      content: "3. Service sessions close, and this window closes last.",
      fg: colors.softWhite,
    }),
    Text({
      content:
        "tmux sessions outside the firstmate-* and pandamate:* namespaces are left alone.",
      fg: colors.muted,
    }),
    Text({
      content: "Press y to close all of Pandamate, or n / Esc to cancel.",
      fg: colors.amber,
    }),
  );
}

const shutdownPhaseLabels = [
  ["draining", "Drain the daemon"],
  ["firstmates", "Close every FirstMate"],
  ["daemon", "Stop the daemon"],
  ["windows", "Close Pandamate windows"],
] as const;

function shutdownOutcomeGlyph(
  outcome: TuiShutdownProgress["sessions"][number]["outcome"],
): { readonly glyph: string; readonly color: string } {
  switch (outcome) {
    case "requested":
      return { glyph: "◉", color: colors.amber };
    case "closed":
      return { glyph: "✓", color: colors.bamboo };
    case "forced":
      return { glyph: "⨯", color: colors.coral };
    case "failed":
      return { glyph: "!", color: colors.coral };
    case "left-running":
      return { glyph: "◐", color: colors.purple };
  }
}

function shutdownPanel(progress: TuiShutdownProgress | null) {
  const phase = progress?.phase ?? "draining";
  const reached =
    phase === "closed"
      ? shutdownPhaseLabels.length
      : shutdownPhaseLabels.findIndex(([name]) => name === phase);
  return Box(
    {
      id: "shutdown-view",
      title: " CLOSING PANDAMATE ",
      borderStyle: "double",
      borderColor: phase === "failed" ? colors.coral : colors.amber,
      backgroundColor: colors.panel,
      flexDirection: "column",
      flexGrow: 1,
      padding: 1,
      gap: 1,
    },
    Text({
      content: progress?.headline ?? "Starting the full shutdown…",
      fg: phase === "failed" ? colors.coral : colors.softWhite,
    }),
    Box(
      { flexDirection: "column" },
          ...shutdownPhaseLabels.map(([, label], index) =>
        Text({
          content: `${index < reached ? "✓" : index === reached ? "›" : "·"} ${label}`,
          fg:
            index < reached
              ? colors.bamboo
              : index === reached
                ? colors.cyan
                : colors.muted,
        }),
      ),
    ),
    Box(
      { flexDirection: "column", flexGrow: 1 },
      ...(progress && progress.sessions.length > 0
        ? progress.sessions.slice(0, 20).map((step) => {
            const outcome = shutdownOutcomeGlyph(step.outcome);
            return Text({
              content: `${outcome.glyph} ${step.session}  ·  ${step.detail}`,
              fg: outcome.color,
            });
          })
        : [
            Text({
              content: "No FirstMate sessions to close.",
              fg: colors.muted,
            }),
          ]),
    ),
    ...(progress && progress.foreign.length > 0
      ? [
          Text({
            content: `Left untouched: ${progress.foreign.join(", ")}`,
            fg: colors.muted,
          }),
        ]
      : []),
  );
}

function projectPanel(project: ProjectSummary, screen: Screen) {
  const warning =
    screen === "confirm-kill"
      ? Box(
          {
            title: " CONFIRM DESTRUCTIVE ACTION ",
            borderStyle: "double",
            borderColor: colors.coral,
            flexDirection: "column",
            padding: 1,
            gap: 1,
          },
          Text({
            content: `Stop tmux session "${project.sessionName ?? project.name}"?`,
            fg: colors.coral,
          }),
          Text({
            content: "Every window and pane in this session will be terminated.",
            fg: colors.softWhite,
          }),
          Text({
            content: "Press y to confirm, or n / Esc to cancel.",
            fg: colors.amber,
          }),
        )
      : screen === "confirm-graceful"
        ? Box(
            {
              title: " CONFIRM GRACEFUL SHUTDOWN ",
              borderStyle: "double",
              borderColor: colors.amber,
              flexDirection: "column",
              padding: 1,
              gap: 1,
            },
            Text({
              content: `Ask FirstMate "${project.sessionName ?? project.name}" to shut itself down?`,
              fg: colors.amber,
            }),
            Text({
              content:
                "The shutdown message will be typed into the active pane of tmux window 0.",
              fg: colors.softWhite,
            }),
            Text({
              content: "Press y to confirm, or n / Esc to cancel.",
              fg: colors.amber,
            }),
          )
      : screen === "confirm-reset"
        ? Box(
            {
              title: " CONFIRM FIRSTMATE RESET ",
              borderStyle: "double",
              borderColor: colors.purple,
              flexDirection: "column",
              padding: 1,
              gap: 1,
            },
            Text({
              content: `Gracefully stop and redeploy FirstMate "${project.sessionName ?? project.name}"?`,
              fg: colors.purple,
            }),
            Text({
              content:
                "The main pane stays alive while workers, Watcher and service windows are rebuilt.",
              fg: colors.softWhite,
            }),
            Text({
              content: "Press y to confirm, or n / Esc to cancel.",
              fg: colors.amber,
            }),
          )
      : Box(
          {
            title: " ACTIONS ",
            borderStyle: "rounded",
            borderColor: colors.purple,
            flexDirection: "column",
            padding: 1,
            gap: 1,
          },
          Text({
            content: project.profile
              ? "[o] Open as a tab of this Pandamate window"
              : "[o] Open in a new iTerm window",
            fg: project.sessionName ? colors.cyan : colors.muted,
          }),
          Text({
            content: "[g] Graceful shutdown via FirstMate",
            fg: project.sessionName ? colors.amber : colors.muted,
          }),
          Text({
            content: "[r] Reset: graceful stop + deploy",
            fg: project.sessionName ? colors.purple : colors.muted,
          }),
          Text({
            content: "[x] Stop entire tmux session",
            fg: project.sessionName ? colors.coral : colors.muted,
          }),
        );

  return Box(
    {
      id: "project-view",
      title: ` PROJECT: ${project.name.toUpperCase()} `,
      borderStyle: "rounded",
      borderColor: colors.cyan,
      backgroundColor: colors.panel,
      flexDirection: "column",
      flexGrow: 1,
      padding: 1,
      gap: 1,
    },
    Text({ content: project.summary, fg: colors.softWhite }),
    Text({
      content: `profile: ${project.profile ?? "unclassified"} · state: ${project.state} · tmux: ${project.sessionName ?? "not connected"}`,
      fg: stateColor(project.state),
    }),
    warning,
  );
}

function buildDeck(
  renderer: CliRenderer,
  model: DeckModel,
  screen: Screen,
  events: readonly EventSummary[],
  selectedEventIndex: number,
  message: string | null,
  pandamateInput: string,
  shutdownProgress: TuiShutdownProgress | null,
  onSelect: (index: number) => void,
) {
  const mode = layoutForWidth(renderer.width);
  const project = selectedProject(model);

  if (screen === "confirm-shutdown-all" || screen === "shutdown") {
    return Box(
      {
        id: "deck",
        width: "100%",
        height: "100%",
        backgroundColor: colors.graphite,
        flexDirection: "column",
        padding: 1,
        gap: 1,
      },
      header(model, "shutdown"),
      screen === "shutdown"
        ? shutdownPanel(shutdownProgress)
        : shutdownConfirmPanel(model),
      footer(screen, message),
    );
  }

  if (screen === "input") {
    return Box(
      {
        id: "deck",
        width: "100%",
        height: "100%",
        backgroundColor: colors.graphite,
        flexDirection: "column",
        padding: 1,
        gap: 1,
      },
      header(model, "compose"),
      pandamateInputPanel(pandamateInput),
      footer(screen, message),
    );
  }

  if (screen === "events") {
    return Box(
      {
        id: "deck",
        width: "100%",
        height: "100%",
        backgroundColor: colors.graphite,
        flexDirection: "column",
        padding: 1,
        gap: 1,
      },
      header(model, "event journal"),
      eventJournalPanel(events, selectedEventIndex),
      footer(screen, message),
    );
  }

  if (screen === "services") {
    return Box(
      {
        id: "deck",
        width: "100%",
        height: "100%",
        backgroundColor: colors.graphite,
        flexDirection: "column",
        padding: 1,
        gap: 1,
      },
      header(model, "services"),
      servicesPanel(model.services),
      footer(screen, message),
    );
  }

  if (screen !== "home") {
    return Box(
      {
        id: "deck",
        width: "100%",
        height: "100%",
        backgroundColor: colors.graphite,
        flexDirection: "column",
        padding: 1,
        gap: 1,
      },
      header(model, mode),
      projectPanel(project, screen),
      footer(screen, message),
    );
  }

  const main =
    mode === "wide"
      ? Box(
          { flexGrow: 1, flexDirection: "row", gap: 1 },
          Box(
            { width: "34%", flexDirection: "column" },
            fleetPanel(model, onSelect),
          ),
          Box(
            { width: "66%", flexDirection: "column" },
            detailPanel(project),
          ),
        )
      : mode === "standard"
        ? Box(
            { flexGrow: 1, flexDirection: "row", gap: 1 },
            Box(
              { width: "40%", flexDirection: "column" },
              fleetPanel(model, onSelect),
            ),
            Box(
              { width: "60%", flexDirection: "column" },
              detailPanel(project),
            ),
          )
        : Box(
            { flexGrow: 1, flexDirection: "column" },
            fleetPanel(model, onSelect),
          );

  const lower =
    mode === "wide"
      ? Box(
          { height: 6, flexDirection: "row", gap: 1 },
          activityPanel(events),
          servicesPanel(model.services, true),
        )
      : mode === "standard"
        ? Box({ height: 6 }, servicesPanel(model.services, true))
        : Box(
            { height: 5 },
            Text({
              content: `${project.name}: ${project.summary}`,
              fg: colors.amber,
            }),
          );

  return Box(
    {
      id: "deck",
      width: "100%",
      height: "100%",
      backgroundColor: colors.graphite,
      flexDirection: "column",
      padding: 1,
      gap: 1,
    },
    header(model, mode),
    main,
    lower,
    footer(screen, message),
  );
}

const renderer = await createCliRenderer({
  exitOnCtrlC: true,
  targetFps: 8,
  maxFps: 16,
  useMouse: true,
  enableMouseMovement: false,
  backgroundColor: colors.graphite,
});

renderer.setTerminalTitle("Pandamate · Phase 0 TUI spike");

let projects: readonly ProjectSummary[] = process.env.PANDAMATE_PROJECTS_JSON
  ? parseInjectedProjects(process.env.PANDAMATE_PROJECTS_JSON)
  : demoProjects;
let services: readonly ServiceSummary[] = process.env.PANDAMATE_SERVICES_JSON
  ? parseInjectedServices(process.env.PANDAMATE_SERVICES_JSON)
  : [];
let events: readonly EventSummary[] = process.env.PANDAMATE_EVENTS_JSON
  ? parseInjectedEvents(process.env.PANDAMATE_EVENTS_JSON)
  : [];
let selectedIndex = 0;
let selectedEventIndex = Math.max(0, events.length - 1);
let screen: Screen = "home";
let actionMessage: string | null = null;
let pandamateInput = "";
let shutdownProgress: TuiShutdownProgress | null = null;
let reducedMotion =
  process.env.PANDAMATE_REDUCED_MOTION === "1" ||
  process.env.REDUCED_MOTION === "1";
let pulseOn = true;
let pulseTimer: ReturnType<typeof setInterval> | null = null;

function currentModel(): DeckModel {
  return {
    projects,
    services,
    selectedIndex,
    reducedMotion,
    pulseOn,
  };
}

function render(): void {
  const oldDeck = renderer.root.getRenderable("deck");
  if (oldDeck) {
    oldDeck.destroyRecursively();
  }
  renderer.root.add(
    buildDeck(
      renderer,
      currentModel(),
      screen,
      events,
      selectedEventIndex,
      actionMessage,
      pandamateInput,
      shutdownProgress,
      select,
    ),
  );
}

function select(index: number): void {
  selectedIndex = index;
  render();
}

function stopPulse(): void {
  if (pulseTimer) {
    clearInterval(pulseTimer);
    pulseTimer = null;
  }
}

function startPulse(): void {
  stopPulse();
  if (reducedMotion) {
    pulseOn = true;
    return;
  }
  pulseTimer = setInterval(() => {
    pulseOn = !pulseOn;
    render();
  }, 800);
}

function shutdown(exitCode = 0): void {
  stopPulse();
  renderer.destroy();
  if (process.connected && process.disconnect) {
    process.disconnect();
  }
  setImmediate(() => process.exit(exitCode));
}

function requestAction(
  action: SessionTuiAction,
  project: ProjectSummary,
): void {
  if (!project.sessionName) {
    actionMessage = "This item is not connected to a live tmux session.";
    render();
    return;
  }
  if (!process.send) {
    actionMessage =
      "Control channel unavailable. Start with spike:tui:discovered.";
    render();
    return;
  }
  const request: TuiActionRequest = {
    type: "action.request",
    action,
    sessionName: project.sessionName,
  };
  actionMessage =
    action === "session.open"
      ? `Opening ${project.sessionName}…`
      : action === "session.graceful-shutdown"
        ? `Requesting graceful shutdown of ${project.sessionName}…`
        : action === "session.reset"
          ? `Requesting reset of ${project.sessionName}…`
        : `Stopping ${project.sessionName}…`;
  process.send(request);
  render();
}

/**
 * Relaunch Pandamate itself from the code currently on disk: the host restarts
 * the daemon and respawns this very tmux pane, so a change lands without
 * quitting to a shell or relaunching the app from the desktop.
 */
function requestReload(): void {
  if (!process.send) {
    actionMessage =
      "Control channel unavailable. Start with spike:tui:discovered.";
    render();
    return;
  }
  const request: TuiActionRequest = {
    type: "action.request",
    action: "pandamate.reload",
  };
  process.send(request);
  actionMessage = "Reloading Pandamate from the code on disk…";
  render();
}

/**
 * Ask the host to close all of Pandamate. From here on the daemon projection
 * stops arriving — the daemon is part of what is being closed — so the screen
 * lives entirely off the pushed shutdown progress until this window itself is
 * closed as the final step.
 */
function requestFullShutdown(): void {
  if (!process.send) {
    actionMessage =
      "Control channel unavailable. Start with spike:tui:discovered.";
    screen = "home";
    render();
    return;
  }
  const request: TuiActionRequest = {
    type: "action.request",
    action: "pandamate.shutdown-all",
  };
  process.send(request);
  shutdownProgress = null;
  screen = "shutdown";
  actionMessage = null;
  render();
}

function submitPandamateInput(): void {
  const text = pandamateInput.trim();
  if (!text) {
    actionMessage = "Write a command before submitting.";
    render();
    return;
  }
  if (!process.send) {
    actionMessage =
      "Control channel unavailable. Start with spike:tui:discovered.";
    screen = "home";
    render();
    return;
  }
  const request: TuiActionRequest = {
    type: "action.request",
    action: "pandamate.submit",
    text,
  };
  process.send(request);
  pandamateInput = "";
  screen = "home";
  actionMessage = "Pandamate is processing your request…";
  render();
}

renderer.keyInput.on("keypress", (key) => {
  if (screen === "input") {
    if (key.name === "escape") {
      pandamateInput = "";
      actionMessage = "Input cancelled.";
      screen = "home";
    } else if (key.name === "enter" || key.name === "return") {
      submitPandamateInput();
      return;
    } else if (key.name === "backspace") {
      pandamateInput = [...pandamateInput].slice(0, -1).join("");
    } else if (
      !key.ctrl &&
      !key.meta &&
      key.sequence.length > 0 &&
      !/[\u0000-\u001f\u007f]/.test(key.sequence) &&
      pandamateInput.length + key.sequence.length <= 2048
    ) {
      pandamateInput += key.sequence;
    }
    render();
    return;
  }

  if (screen === "shutdown") {
    // Nothing to steer while Pandamate closes itself; only a failed shutdown
    // hands the keyboard back, so a stuck sequence is never a trapped TUI.
    if (
      shutdownProgress?.phase === "failed" &&
      (key.name === "escape" || key.name === "q")
    ) {
      screen = "home";
      actionMessage = shutdownProgress.headline;
      render();
    }
    return;
  }

  if (screen === "confirm-shutdown-all") {
    if (key.name === "y") {
      requestFullShutdown();
    } else if (key.name === "n" || key.name === "escape") {
      screen = "home";
      actionMessage = "Full shutdown cancelled.";
      render();
    }
    return;
  }

  if (key.sequence === "R") {
    requestReload();
    return;
  }

  if (key.sequence === "X") {
    screen = "confirm-shutdown-all";
    actionMessage = null;
    render();
    return;
  }

  if (key.name === "q") {
    shutdown();
    return;
  }

  if (screen === "home" && key.name === "i") {
    screen = "input";
    actionMessage = null;
    pandamateInput = "";
    render();
    return;
  }

  if (screen === "home" && key.name === "s") {
    screen = "services";
    actionMessage = null;
    render();
    return;
  }

  if (screen === "events" || screen === "services") {
    if (key.name === "escape") {
      screen = "home";
      actionMessage = null;
      render();
    } else if (
      screen === "events" &&
      (key.name === "up" || key.name === "k")
    ) {
      selectedEventIndex = moveSelection(
        selectedEventIndex,
        -1,
        events.length,
      );
      render();
    } else if (
      screen === "events" &&
      (key.name === "down" || key.name === "j")
    ) {
      selectedEventIndex = moveSelection(
        selectedEventIndex,
        1,
        events.length,
      );
      render();
    }
    return;
  }

  const project = projects[selectedIndex];
  if (!project) {
    return;
  }

  if (screen === "confirm-kill") {
    if (key.name === "y") {
      screen = "project";
      requestAction("session.kill", project);
    } else if (key.name === "n" || key.name === "escape") {
      screen = "project";
      actionMessage = "Stop cancelled.";
      render();
    }
    return;
  }

  if (screen === "confirm-graceful") {
    if (key.name === "y") {
      screen = "project";
      requestAction("session.graceful-shutdown", project);
    } else if (key.name === "n" || key.name === "escape") {
      screen = "project";
      actionMessage = "Graceful shutdown cancelled.";
      render();
    }
    return;
  }

  if (screen === "confirm-reset") {
    if (key.name === "y") {
      screen = "project";
      requestAction("session.reset", project);
    } else if (key.name === "n" || key.name === "escape") {
      screen = "project";
      actionMessage = "Reset cancelled.";
      render();
    }
    return;
  }

  if (screen === "project") {
    if (key.name === "escape") {
      screen = "home";
      actionMessage = null;
      render();
    } else if (key.name === "o") {
      requestAction("session.open", project);
    } else if (key.name === "g" && project.sessionName) {
      screen = "confirm-graceful";
      actionMessage = null;
      render();
    } else if (key.name === "r" && project.sessionName) {
      screen = "confirm-reset";
      actionMessage = null;
      render();
    } else if (key.name === "x" && project.sessionName) {
      screen = "confirm-kill";
      actionMessage = null;
      render();
    }
    return;
  }

  if (key.name === "escape") {
    return;
  } else if (key.name === "enter" || key.name === "return") {
    screen = "project";
    actionMessage = null;
    render();
  } else if (key.name === "up" || key.name === "k") {
    select(moveSelection(selectedIndex, -1, projects.length));
  } else if (key.name === "down" || key.name === "j") {
    select(moveSelection(selectedIndex, 1, projects.length));
  } else if (key.name === "r") {
    reducedMotion = !reducedMotion;
    startPulse();
    render();
  } else if (key.name === "d") {
    renderer.toggleDebugOverlay();
  } else if (key.name === "e") {
    screen = "events";
    actionMessage = null;
    render();
  }
});

renderer.keyInput.on("paste", (event) => {
  if (screen !== "input") {
    return;
  }
  const pasted = new TextDecoder()
    .decode(event.bytes)
    .replaceAll(/[\r\n\t]+/g, " ");
  pandamateInput = `${pandamateInput}${pasted}`.slice(0, 2048);
  render();
});

process.on("message", (value: unknown) => {
  try {
    if (
      typeof value === "object" &&
      value !== null &&
      (value as Record<string, unknown>).type === "shutdown.progress"
    ) {
      shutdownProgress = parseTuiShutdownProgress(value);
      screen = "shutdown";
      render();
      return;
    }
    if (
      typeof value === "object" &&
      value !== null &&
      (value as Record<string, unknown>).type === "projection.update"
    ) {
      const update = parseTuiProjectionUpdate(value);
      const selectedName = projects[selectedIndex]?.name;
      projects = update.projects;
      services = update.services;
      events = update.events;
      const matchingIndex = selectedName
        ? projects.findIndex((project) => project.name === selectedName)
        : -1;
      selectedIndex =
        matchingIndex >= 0
          ? matchingIndex
          : Math.min(selectedIndex, Math.max(0, projects.length - 1));
      selectedEventIndex = Math.max(0, events.length - 1);
      render();
      return;
    }
    const result = parseTuiActionResult(value);
    actionMessage = result.message;
    if (
      result.success &&
      result.action === "session.graceful-shutdown"
    ) {
      projects = projects.map((project) =>
        project.sessionName === result.sessionName
          ? {
              ...project,
              state: "waiting",
              summary:
                "Crew shutdown requested; main FirstMate remains available.",
            }
          : project,
      );
      screen = "home";
    }
    if (result.success && result.action === "session.kill") {
      projects = projects.map((project) =>
        project.sessionName === result.sessionName
          ? {
              ...project,
              sessionName: null,
              state: "stopped",
              summary: "Runtime stopped; project retained in Fleet.",
            }
          : project,
      );
      selectedIndex = Math.max(
        0,
        Math.min(selectedIndex, projects.length - 1),
      );
      screen = "home";
    }
    render();
  } catch (error) {
    actionMessage =
      error instanceof Error ? error.message : "Invalid control response";
    render();
  }
});

renderer.on("resize", render);
renderer.on("blur", stopPulse);
renderer.on("focus", startPulse);
renderer.on("destroy", stopPulse);

process.on("uncaughtException", (error) => {
  process.stderr.write(`${error.stack ?? error.message}\n`);
  shutdown(1);
});

process.on("unhandledRejection", (reason) => {
  process.stderr.write(`Unhandled rejection: ${String(reason)}\n`);
  shutdown(1);
});

render();
startPulse();
