import { fork, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";

import {
  buildBrainBriefing,
  PandamateBrain,
} from "@pandamate/agent-sdk";
import { daemonLifecycle, requestDaemon } from "@pandamate/client";
import { loadConfig } from "@pandamate/config";
import {
  buildProjectOnboarding,
  parseProjectOnboardingText,
  type EventRecord,
  type Decision,
  type Message,
  type Project,
} from "@pandamate/domain";
import {
  protocolVersion,
  type ResponseData,
} from "@pandamate/protocol";
import {
  closePandamateSessions,
  configureControlStatusBar,
  controlTabForSession,
  discoverTmuxSessions,
  openSessionInNewITermWindow,
  requestFirstMateReset,
  requestGracefulSessionShutdown,
  shutdownFleet,
  TmuxClient,
  type FleetShutdownReport,
} from "@pandamate/runtime-tmux";

import {
  parseTuiActionRequest,
  type TuiActionResult,
  type TuiShutdownProgress,
} from "../../tui/src/control-protocol.ts";
import type {
  EventSummary,
  ProjectSummary,
  ServiceSummary,
} from "../../tui/src/model.ts";
import {
  projectSummariesFromDaemon,
  projectSummariesFromTmux,
  serviceSummariesFromTmux,
} from "./discovery.ts";
import {
  configuredFirstMateProfile,
  pathOnlyInput,
} from "./onboarding.ts";

const tmux = new TmuxClient();
const controlLog = "/private/tmp/pandamate-control.log";
function logControl(event: string, detail: string): void {
  appendFileSync(
    controlLog,
    `${new Date().toISOString()} ${event} ${detail.replaceAll("\n", " ")}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
}
const config = loadConfig();
const brain = new PandamateBrain({
  cwd: resolve(import.meta.dirname, "../../.."),
  claudeExecutable: config.claudeExecutable,
});

const entryPath = import.meta.filename;

function ownPane(): string | null {
  const pane = process.env.TMUX_PANE ?? "";
  return /^%\d+$/.test(pane) ? pane : null;
}

/**
 * Keep the tmux key hints on screen for the session this TUI runs in — a
 * FirstMate tab owns the whole window once it is selected, so the keys that
 * lead back to Home cannot live inside the app — and clear the remain-on-exit
 * guard a reload leaves behind now that this process is up.
 */
function dressOwnSession(): void {
  try {
    configureControlStatusBar(
      tmux,
      tmux.run(["display-message", "-p", "#{session_id}"]),
    );
    const pane = ownPane();
    if (pane) {
      tmux.run(["set-window-option", "-t", pane, "remain-on-exit", "off"]);
    }
  } catch (error) {
    logControl(
      "status.bar.failed",
      error instanceof Error ? error.message : String(error),
    );
  }
}
dressOwnSession();

function eventSummary(event: EventRecord): EventSummary {
  const payload = event.payload;
  const subject =
    typeof payload.slug === "string"
      ? payload.slug
      : event.projectId
        ? event.projectId
        : "system";
  const detailParts = [payload.title, payload.kind, payload.workspace].filter(
    (part): part is string => typeof part === "string",
  );
  return {
    sequence: event.sequence,
    timestamp: event.recordedAt,
    type: event.type,
    subject,
    detail: detailParts.join(" · "),
  };
}

async function fetchDaemonProjects(): Promise<readonly Project[] | null> {
  const response = await requestDaemon(config.socketPath, {
    protocol: protocolVersion,
    requestId: `req_tui_${randomUUID()}`,
    type: "project.list",
    payload: {},
  }).catch(() => null);
  if (!response?.ok) {
    return null;
  }
  const data = response.data as ResponseData as unknown as Record<
    string,
    unknown
  >;
  return Array.isArray(data.projects)
    ? (data.projects as readonly Project[])
    : null;
}

async function fetchDaemonEvents(after: number): Promise<readonly EventRecord[]> {
  const response = await requestDaemon(config.socketPath, {
    protocol: protocolVersion,
    requestId: `req_tui_${randomUUID()}`,
    type: "event.list",
    payload: { after, limit: 100 },
  }).catch(() => null);
  if (!response?.ok) {
    return [];
  }
  const data = response.data as ResponseData as unknown as Record<
    string,
    unknown
  >;
  return Array.isArray(data.events)
    ? (data.events as readonly EventRecord[])
    : [];
}

async function fetchBrainBriefing(): Promise<string> {
  const [messageResponse, decisionResponse] = await Promise.all([
    requestDaemon(config.socketPath, {
      protocol: protocolVersion,
      requestId: `req_tui_${randomUUID()}`,
      type: "message.list",
      payload: { limit: 100 },
    }),
    requestDaemon(config.socketPath, {
      protocol: protocolVersion,
      requestId: `req_tui_${randomUUID()}`,
      type: "decision.list",
      payload: { includeSuperseded: false },
    }),
  ]);
  if (!messageResponse.ok || !decisionResponse.ok) {
    throw new Error("Pandamate could not build its durable briefing.");
  }
  const messageData = messageResponse.data as unknown as Record<string, unknown>;
  const decisionData = decisionResponse.data as unknown as Record<string, unknown>;
  return buildBrainBriefing({
    projects: durableProjects,
    decisions: Array.isArray(decisionData.decisions)
      ? (decisionData.decisions as readonly Decision[])
      : [],
    messages: Array.isArray(messageData.messages)
      ? (messageData.messages as readonly Message[])
      : [],
    events: (await fetchDaemonEvents(Math.max(0, eventCursor - 100))).slice(-100),
  });
}

async function askBrain(question: string): Promise<string> {
  const briefing = await fetchBrainBriefing();
  let answer = "";
  for await (const chunk of brain.ask(question, briefing)) {
    if (chunk.type === "text") {
      answer += chunk.text;
    } else if (chunk.type === "result" && answer.length === 0) {
      answer = chunk.text;
    } else if (chunk.type === "error") {
      throw new Error(chunk.text || "Pandamate brain failed.");
    }
  }
  return answer.trim() || "Pandamate brain returned no text.";
}

function buildTmuxProjection(
  durable: readonly Project[],
): {
  readonly projects: readonly ProjectSummary[];
  readonly services: readonly ServiceSummary[];
} {
  const sessions = discoverTmuxSessions(tmux);
  const durableSessionNames = new Set(
    durable.flatMap((project) =>
      project.tmuxSessionName ? [project.tmuxSessionName] : [],
    ),
  );
  // The registered project slugs let discovery recognise a crew session by its
  // `fm-<slug>-<task>` windows and fold it into that project instead of showing
  // it as a separate nameless FirstMate.
  const knownSlugs = new Set(durable.map((project) => project.slug));
  return {
    projects: [
      ...projectSummariesFromDaemon(durable, new Date(), sessions),
      ...projectSummariesFromTmux(
        sessions.filter(
          (session) => !durableSessionNames.has(session.name),
        ),
        knownSlugs,
      ),
    ],
    services: serviceSummariesFromTmux(sessions),
  };
}

let durableProjects = (await fetchDaemonProjects()) ?? [];
let tmuxProjection = buildTmuxProjection(durableProjects);
let projects = tmuxProjection.projects;
let services = tmuxProjection.services;
let events = (await fetchDaemonEvents(0)).map(eventSummary);
const allowedSessions = new Set(
  projects.flatMap((project) =>
    project.sessionName ? [project.sessionName] : [],
  ),
);
const projectSlugBySession = new Map<string, string>();
function rebuildRuntimeIndexes(): void {
  allowedSessions.clear();
  projectSlugBySession.clear();
  for (const project of projects) {
    if (project.sessionName) {
      allowedSessions.add(project.sessionName);
    }
  }
  for (const project of durableProjects) {
    if (project.tmuxSessionName && project.tmuxTarget) {
      projectSlugBySession.set(project.tmuxSessionName, project.slug);
    }
  }
}
rebuildRuntimeIndexes();
const tuiEntry = resolve(import.meta.dirname, "../../tui/src/index.ts");
const child = fork(tuiEntry, [], {
  env: {
    ...process.env,
    PANDAMATE_PROJECTS_JSON: JSON.stringify(projects),
    PANDAMATE_SERVICES_JSON: JSON.stringify(services),
    PANDAMATE_EVENTS_JSON: JSON.stringify(events),
  },
  execArgv: ["--experimental-ffi"],
  stdio: ["inherit", "inherit", "inherit", "ipc"],
});
logControl("launcher.started", `child=${child.pid ?? "unknown"}`);

function sendResult(result: TuiActionResult): void {
  logControl(
    "action.result",
    `${result.action} ${result.sessionName ?? "pandamate"} success=${result.success} ${result.message}`,
  );
  if (child.connected) {
    child.send(result);
  } else {
    logControl("action.result.dropped", "child IPC disconnected");
  }
}

async function pingDaemon(): Promise<boolean> {
  const response = await requestDaemon(config.socketPath, {
    protocol: protocolVersion,
    requestId: `req_tui_${randomUUID()}`,
    type: "system.ping",
    payload: {},
  }).catch(() => null);
  return response?.ok === true;
}

async function waitForDaemon(expected: boolean): Promise<boolean> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if ((await pingDaemon()) === expected) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

/**
 * A reload is only honest if the daemon runs the same code as the UI: it holds
 * the tmux runtime and the supervisor, and it runs sources directly, so
 * restarting it is how a change goes live. Running FirstMates survive — the
 * daemon never kills tmux sessions on its way down.
 */
async function restartDaemon(): Promise<void> {
  await requestDaemon(config.socketPath, {
    protocol: protocolVersion,
    requestId: `req_tui_${randomUUID()}`,
    type: "system.shutdown",
    payload: {},
  }).catch(() => null);
  if (!(await waitForDaemon(false))) {
    throw new Error("The old Pandamate daemon did not stop; reload aborted.");
  }
  const daemonEntry = new URL(
    "../../../apps/daemon/src/main.ts",
    import.meta.url,
  );
  spawn(process.execPath, [daemonEntry.pathname], {
    detached: true,
    env: process.env,
    stdio: "ignore",
  }).unref();
  if (!(await waitForDaemon(true))) {
    throw new Error("The new Pandamate daemon did not answer; reload aborted.");
  }
}

/**
 * Restart the TUI in place by respawning the pane it lives in with the very
 * command it was started with, so the reload works the same whether the pane
 * came from the desktop launcher or was created by hand.
 */
function reloadOwnPane(): void {
  const pane = ownPane();
  if (!pane) {
    throw new Error("Pandamate can only reload itself inside a tmux pane.");
  }
  // `#{pane_start_command}` comes back quoted and does not survive a round
  // trip through respawn-pane, so the relaunch is spelled out as argv: same
  // interpreter, same entry file, no shell in between.
  logControl("reload.respawn", `${pane} ${process.execPath} ${entryPath}`);
  // remain-on-exit keeps a relaunch that fails to boot visible as a dead pane
  // instead of closing the window out from under the user; the fresh process
  // turns it back off once it is up.
  tmux.run(["set-window-option", "-t", pane, "remain-on-exit", "on"]);
  tmux.run(["respawn-pane", "-k", "-t", pane, process.execPath, entryPath]);
}

let lastLoggedShutdown = "";
let lastShutdownLogAt = 0;

function sendShutdownProgress(report: FleetShutdownReport): void {
  // The screen ticks every second; the log keeps what a later diagnosis needs —
  // every change, and a heartbeat through the long waits in between.
  const signature = `${report.phase} ${report.sessions
    .map((step) => `${step.session}=${step.outcome}`)
    .join(",")}`;
  const now = Date.now();
  if (signature !== lastLoggedShutdown || now - lastShutdownLogAt >= 30_000) {
    lastLoggedShutdown = signature;
    lastShutdownLogAt = now;
    logControl("shutdown.progress", `${report.phase} ${report.headline}`);
  }
  if (child.connected) {
    const progress: TuiShutdownProgress = {
      type: "shutdown.progress",
      phase: report.phase,
      headline: report.headline,
      sessions: report.sessions,
      foreign: report.foreign,
    };
    child.send(progress);
  }
}

/**
 * Close all of Pandamate from the one process that can: this launcher owns the
 * tmux client and lives inside `pandamate:home`, so it can drive every step and
 * then end the window it runs in. FirstMates go first and gracefully, the
 * daemon second, Pandamate's own windows last — which is where this process
 * stops existing, so nothing may be scheduled after it.
 */
async function closeAllOfPandamate(): Promise<void> {
  clearInterval(refreshTimer);
  try {
    const report = await shutdownFleet({
      tmux,
      daemon: daemonLifecycle(config.socketPath),
      graceMilliseconds: config.shutdownGraceMs,
      onProgress: sendShutdownProgress,
    });
    if (report.phase === "failed") {
      return;
    }
    sendShutdownProgress({
      ...report,
      phase: "windows",
      headline: "Closing Pandamate's own windows…",
    });
    // The last frame has to reach the TUI before its window is destroyed.
    await new Promise((resolve) => setTimeout(resolve, 600));
    const teardown = closePandamateSessions(tmux);
    // Only reached when home was not running: report and stay available.
    sendShutdownProgress({
      ...report,
      phase: "closed",
      headline:
        teardown.closed.length === 0
          ? "No Pandamate windows were open."
          : `Closed ${teardown.closed.join(", ")}.`,
    });
  } catch (error) {
    sendShutdownProgress({
      phase: "failed",
      headline:
        error instanceof Error
          ? error.message
          : "Pandamate could not close itself.",
      sessions: [],
      foreign: [],
    });
  }
}

/**
 * How long Pandamate waits for a started FirstMate's tmux session before it
 * stops holding the screen. The supervisor creates the session on its first
 * pass and reports the runtime on the next, so this is many reconciliation
 * intervals of headroom — long enough that expiring means something is wrong,
 * short enough that the user is not left staring at a promise.
 */
const startTimeoutMs = 30_000;

/**
 * Wait for the supervisor to actually build a started project's runtime, and
 * answer with the session it built. The daemon is asked rather than tmux
 * directly: a session name exists in durable state long after its session is
 * gone, and only a recorded `tmuxTarget` means Pandamate has seen this one
 * alive. Null when it does not come up in time.
 */
async function waitForProjectRuntime(slug: string): Promise<string | null> {
  const deadline = Date.now() + startTimeoutMs;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    const project = ((await fetchDaemonProjects()) ?? []).find(
      (candidate) => candidate.slug === slug,
    );
    if (
      project?.tmuxTarget &&
      project.tmuxSessionName &&
      tmux.hasSession(project.tmuxSessionName)
    ) {
      return project.tmuxSessionName;
    }
  }
  return null;
}

/**
 * Open the tab of a FirstMate that has just been started again, and describe
 * where it landed. A tab that cannot be opened — home is not running, the
 * session died in the same breath — never turns the start itself into a
 * failure: the FirstMate is up either way, and saying otherwise would send the
 * user looking for a problem that is not there.
 */
async function openStartedProjectTab(
  slug: string,
  sessionName: string,
): Promise<string> {
  try {
    const response = await requestDaemon(config.socketPath, {
      protocol: protocolVersion,
      requestId: `req_tui_${randomUUID()}`,
      type: "project.open",
      payload: { slug },
    });
    if (!response.ok) {
      throw new Error(response.error.message);
    }
    const tab = controlTabForSession(tmux, sessionName);
    return (
      tab
        ? `${slug} is running again as Pandamate Home tab ${tab.index} "${tab.name}" — switch with tmux prefix + ${tab.index}.`
        : `${slug} is running again and opened as a Pandamate Home tab.`
    ).slice(0, 240);
  } catch (error) {
    logControl(
      "project.start.tab_failed",
      error instanceof Error ? error.message : String(error),
    );
    return `${slug} is running again in ${sessionName}, but its tab could not be opened: ${
      error instanceof Error ? error.message : "unknown error"
    }`.slice(0, 240);
  }
}

let refreshInProgress = false;
let eventCursor = events.at(-1)?.sequence ?? 0;
let lastProjectionJson = JSON.stringify({ projects, services, events });
async function refreshProjection(): Promise<void> {
  if (refreshInProgress) {
    return;
  }
  refreshInProgress = true;
  try {
    const refreshedProjects = await fetchDaemonProjects();
    if (refreshedProjects !== null) {
      durableProjects = refreshedProjects;
    }
    const newEvents = await fetchDaemonEvents(eventCursor);
    if (newEvents.length > 0) {
      eventCursor = newEvents.at(-1)?.sequence ?? eventCursor;
      events = [...events, ...newEvents.map(eventSummary)].slice(-500);
    }
    tmuxProjection = buildTmuxProjection(durableProjects);
    projects = tmuxProjection.projects;
    services = tmuxProjection.services;
    rebuildRuntimeIndexes();
    const projectionJson = JSON.stringify({ projects, services, events });
    if (child.connected && projectionJson !== lastProjectionJson) {
      child.send({
        type: "projection.update",
        projects,
        services,
        events,
      });
      lastProjectionJson = projectionJson;
    }
  } catch (error) {
    logControl(
      "projection.refresh.failed",
      error instanceof Error ? error.message : String(error),
    );
  } finally {
    refreshInProgress = false;
  }
}

const refreshTimer = setInterval(() => {
  void refreshProjection();
}, 500);
refreshTimer.unref();

child.on("message", async (value: unknown) => {
  logControl("action.received", JSON.stringify(value));
  let request;
  try {
    request = parseTuiActionRequest(value);
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : "Invalid TUI action"}\n`,
    );
    return;
  }

  if (request.action === "pandamate.reload") {
    try {
      await restartDaemon();
      reloadOwnPane();
      // respawn-pane kills this process; a result only arrives if it did not.
      sendResult({
        type: "action.result",
        action: request.action,
        success: true,
        message: "Pandamate is relaunching from the code on disk…",
      });
    } catch (error) {
      sendResult({
        type: "action.result",
        action: request.action,
        success: false,
        message:
          error instanceof Error ? error.message : "Pandamate could not reload.",
      });
    }
    return;
  }

  if (request.action === "pandamate.shutdown-all") {
    await closeAllOfPandamate();
    return;
  }

  /**
   * Start a project whose runtime is gone and hand the user back the tab they
   * lost. There is no tmux session to address and no tab to reopen — the
   * FirstMate is deployed again from durable state, exactly the way it was
   * first started: the daemon records that the project is wanted running and
   * the supervisor rebuilds the session, the FirstMate, and its Watcher on its
   * next pass. Only projects the daemon actually knows are startable, so a
   * discovered foreign session can never be launched here.
   *
   * The tab is then opened for the same reason `o` exists: a FirstMate nobody
   * can see is not really back. Waiting is the whole difficulty — the session
   * does not exist when the key is pressed, so the request answers twice: once
   * as soon as the start is durably accepted, and once when the tab is up.
   */
  if (request.action === "project.start") {
    try {
      const project = durableProjects.find(
        (candidate) => candidate.slug === request.slug,
      );
      if (!project) {
        throw new Error(`${request.slug} is not a registered Pandamate project.`);
      }
      const response = await requestDaemon(config.socketPath, {
        protocol: protocolVersion,
        requestId: `req_tui_${randomUUID()}`,
        type: "project.desired.set",
        idempotencyKey: `tui:${randomUUID()}`,
        payload: { slug: project.slug, desiredState: "running" },
      });
      if (!response.ok) {
        throw new Error(response.error.message);
      }
      await refreshProjection();
      sendResult({
        type: "action.result",
        action: request.action,
        slug: project.slug,
        success: true,
        message:
          `Starting ${project.slug} again in ${project.workspace}; opening its tab when it is up…`.slice(
            0,
            240,
          ),
      });
      const started = await waitForProjectRuntime(project.slug);
      if (!started) {
        sendResult({
          type: "action.result",
          action: request.action,
          slug: project.slug,
          success: false,
          message: `${project.slug} has not come up within ${Math.round(startTimeoutMs / 1_000)}s; it stays wanted running, so press o once its session appears.`.slice(
            0,
            240,
          ),
        });
        return;
      }
      sendResult({
        type: "action.result",
        action: request.action,
        slug: project.slug,
        success: true,
        message: await openStartedProjectTab(project.slug, started),
      });
    } catch (error) {
      sendResult({
        type: "action.result",
        action: request.action,
        slug: request.slug,
        success: false,
        message:
          error instanceof Error
            ? error.message
            : `Pandamate could not start ${request.slug}.`,
      });
    }
    return;
  }

  if (request.action === "pandamate.submit") {
    try {
      const submittedPath = pathOnlyInput(request.text);
      const looksLikeOnboarding =
        submittedPath !== null ||
        (request.text.includes("/") &&
          /\b(firstmate[\s_-]*(?:arc|git|docs)|doc[\s_-]*research|arc|git|docs)\b/i.test(
            request.text,
          ));
      if (!looksLikeOnboarding) {
        const answer = await askBrain(request.text);
        sendResult({
          type: "action.result",
          action: request.action,
          success: true,
          message: answer.slice(0, 240),
        });
        return;
      }
      const onboarding =
        submittedPath === null
          ? parseProjectOnboardingText(request.text)
          : (() => {
              const detected = configuredFirstMateProfile(submittedPath);
              return buildProjectOnboarding(
                detected.profile,
                detected.workspace,
              );
            })();
      if (!statSync(onboarding.project.workspace).isDirectory()) {
        throw new Error(
          `Workspace is not a directory: ${onboarding.project.workspace}`,
        );
      }
      const createResponse = await requestDaemon(config.socketPath, {
        protocol: protocolVersion,
        requestId: `req_tui_${randomUUID()}`,
        type: "project.create",
        idempotencyKey: `tui:${randomUUID()}`,
        payload: onboarding.project,
      });
      if (!createResponse.ok) {
        throw new Error(createResponse.error.message);
      }
      const startResponse = await requestDaemon(config.socketPath, {
        protocol: protocolVersion,
        requestId: `req_tui_${randomUUID()}`,
        type: "project.desired.set",
        idempotencyKey: `tui:${randomUUID()}`,
        payload: {
          slug: onboarding.project.slug,
          desiredState: "running",
        },
      });
      if (!startResponse.ok) {
        throw new Error(startResponse.error.message);
      }
      sendResult({
        type: "action.result",
        action: request.action,
        success: true,
        message: `Created ${onboarding.project.slug} as ${onboarding.profile}; FirstMate start requested.`,
      });
      await refreshProjection();
    } catch (error) {
      sendResult({
        type: "action.result",
        action: request.action,
        success: false,
        message:
          error instanceof Error
            ? error.message
            : "Pandamate could not process the input.",
      });
    }
    return;
  }

  if (!allowedSessions.has(request.sessionName)) {
    sendResult({
      type: "action.result",
      action: request.action,
      sessionName: request.sessionName,
      success: false,
      message: `Session ${request.sessionName} is not an adopted Fleet item.`,
    });
    return;
  }

  try {
    const projectSlug = projectSlugBySession.get(request.sessionName);
    if (!tmux.hasSession(request.sessionName)) {
      throw new Error(`Session ${request.sessionName} is no longer running.`);
    }

    if (request.action === "session.open") {
      if (projectSlug) {
        const response = await requestDaemon(config.socketPath, {
          protocol: protocolVersion,
          requestId: `req_tui_${randomUUID()}`,
          type: "project.open",
          payload: { slug: projectSlug },
        });
        if (!response.ok) {
          throw new Error(response.error.message);
        }
        // FirstMates open as tabs of this very window, so name the tab the user
        // has just been switched to rather than promising a new window.
        const tab = controlTabForSession(tmux, request.sessionName);
        sendResult({
          type: "action.result",
          action: request.action,
          sessionName: request.sessionName,
          success: true,
          message: tab
            ? `${request.sessionName} is Pandamate Home tab ${tab.index} "${tab.name}" — switch with tmux prefix + ${tab.index}.`
            : `Opened ${request.sessionName} as a Pandamate Home tab.`,
        });
        return;
      }
      openSessionInNewITermWindow(tmux, request.sessionName);
      sendResult({
        type: "action.result",
        action: request.action,
        sessionName: request.sessionName,
        success: true,
        message: `Opened ${request.sessionName} in a new iTerm window.`,
      });
      return;
    }

    if (request.action === "session.graceful-shutdown") {
      const launch = requestGracefulSessionShutdown(
        tmux,
        request.sessionName,
      );
      sendResult({
        type: "action.result",
        action: request.action,
        sessionName: request.sessionName,
        success: true,
        message: `Graceful shutdown sent to ${request.sessionName} window 0 (${launch.pane}).`,
      });
      return;
    }

    if (request.action === "session.reset") {
      const launch = requestFirstMateReset(tmux, request.sessionName);
      sendResult({
        type: "action.result",
        action: request.action,
        sessionName: request.sessionName,
        success: true,
        message: `Reset sent to ${request.sessionName} window 0 (${launch.pane}).`,
      });
      return;
    }

    if (projectSlug) {
      const response = await requestDaemon(config.socketPath, {
        protocol: protocolVersion,
        requestId: `req_tui_${randomUUID()}`,
        type: "project.desired.set",
        idempotencyKey: `tui:${randomUUID()}`,
        payload: {
          slug: projectSlug,
          desiredState: "stopped",
        },
      });
      if (!response.ok) {
        throw new Error(response.error.message);
      }
      if (tmux.hasSession(request.sessionName)) {
        tmux.killSession(request.sessionName);
      }
    } else {
      tmux.killSession(request.sessionName);
    }
    await refreshProjection();
    sendResult({
      type: "action.result",
      action: request.action,
      sessionName: request.sessionName,
      success: true,
      message: `Stopped tmux session ${request.sessionName}.`,
    });
  } catch (error) {
    sendResult({
      type: "action.result",
      action: request.action,
      sessionName: request.sessionName,
      success: false,
      message:
        error instanceof Error ? error.message : "The tmux action failed.",
    });
  }
});

child.on("error", (error) => {
  clearInterval(refreshTimer);
  process.stderr.write(`${error.stack ?? error.message}\n`);
  process.exitCode = 1;
});

child.on("exit", (code, signal) => {
  clearInterval(refreshTimer);
  if (signal) {
    process.kill(process.pid, signal);
  } else {
    process.exitCode = code ?? 1;
  }
});
