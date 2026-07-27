import {
  closeControlTab,
  discoverTmuxSessions,
  isPandamateControlSession,
  requestGracefulSessionShutdown,
  targetForPandamateService,
  type DiscoveredTmuxSession,
  type TmuxClient,
} from "./index.ts";

export type FleetShutdownTmux = Pick<
  TmuxClient,
  | "run"
  | "resolveSession"
  | "activePaneInWindowZero"
  | "sendTextAndEnter"
  | "killSession"
>;

/**
 * What a full Pandamate shutdown is allowed to touch. Pandamate closes only the
 * two namespaces it owns — `firstmate-*` project sessions and `pandamate:*`
 * control sessions — and reports everything else as foreign so a shutdown never
 * takes down a tmux session the user runs for their own reasons.
 */
export interface FleetSessionPlan {
  readonly firstMates: readonly string[];
  readonly services: readonly string[];
  readonly home: string | null;
  readonly foreign: readonly string[];
}

export type FleetShutdownPhase =
  | "draining"
  | "firstmates"
  | "daemon"
  | "windows"
  | "closed"
  | "failed";

export type FleetSessionOutcome =
  | "requested"
  | "closed"
  | "forced"
  | "failed"
  | "left-running";

export interface FleetSessionStep {
  readonly session: string;
  readonly outcome: FleetSessionOutcome;
  readonly detail: string;
}

export interface FleetShutdownReport {
  readonly phase: FleetShutdownPhase;
  readonly headline: string;
  readonly sessions: readonly FleetSessionStep[];
  readonly foreign: readonly string[];
}

/**
 * The daemon half of a shutdown, kept as a port so this module stays pure tmux:
 * `drain` must stop the supervisor from resurrecting FirstMates that close
 * themselves, and `stop` ends the daemon once the fleet is down. Both resolve
 * with a human-readable detail; a daemon that is not running is not a failure.
 */
export interface FleetShutdownDaemon {
  readonly drain: () => Promise<string>;
  readonly stop: () => Promise<string>;
}

export interface FleetShutdownOptions {
  readonly tmux: FleetShutdownTmux;
  readonly daemon?: FleetShutdownDaemon;
  readonly graceMilliseconds?: number;
  readonly pollMilliseconds?: number;
  readonly force?: boolean;
  readonly sleep?: (milliseconds: number) => Promise<void>;
  readonly now?: () => number;
  readonly onProgress?: (report: FleetShutdownReport) => void;
}

export interface ControlSessionTeardown {
  readonly closed: readonly string[];
  readonly failed: readonly string[];
}

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function message(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 200);
}

export function planFleetShutdown(
  sessions: readonly DiscoveredTmuxSession[],
): FleetSessionPlan {
  const homeSessionName = targetForPandamateService("home");
  const firstMates: string[] = [];
  const services: string[] = [];
  const foreign: string[] = [];
  let home: string | null = null;
  for (const session of [...sessions].sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    if (session.name === homeSessionName) {
      home = session.name;
    } else if (isPandamateControlSession(session.name)) {
      services.push(session.name);
    } else if (session.name.startsWith("firstmate-")) {
      firstMates.push(session.name);
    } else {
      foreign.push(session.name);
    }
  }
  return { firstMates, services, home, foreign };
}

/**
 * tmux itself is the only progress signal a graceful shutdown has: a FirstMate
 * that finished its own teardown no longer has a session. Discovery failures
 * are therefore treated as "no answer this round" rather than "everything is
 * gone", so a transient tmux error can never be read as success.
 */
function liveSessionNames(tmux: FleetShutdownTmux): ReadonlySet<string> | null {
  try {
    return new Set(discoverTmuxSessions(tmux).map((session) => session.name));
  } catch {
    return null;
  }
}

/**
 * Close every FirstMate the way Panda would by hand: ask each one to shut
 * itself down gracefully, wait for its tmux session to disappear, and only then
 * force what is left. The daemon is drained first — otherwise the supervisor
 * relaunches each FirstMate the moment it closes its own session — and stopped
 * last, once nothing needs supervising. Pandamate's own windows are left alone
 * here; `closePandamateSessions` ends those, because that kills the caller.
 */
export async function shutdownFleet(
  options: FleetShutdownOptions,
): Promise<FleetShutdownReport> {
  const tmux = options.tmux;
  const sleep = options.sleep ?? defaultSleep;
  const now = options.now ?? (() => Date.now());
  const graceMilliseconds = options.graceMilliseconds ?? 300_000;
  const pollMilliseconds = options.pollMilliseconds ?? 1_000;
  const force = options.force ?? true;

  const steps = new Map<string, FleetSessionStep>();
  let plan: FleetSessionPlan = {
    firstMates: [],
    services: [],
    home: null,
    foreign: [],
  };
  let phase: FleetShutdownPhase = "draining";
  let headline = "Preparing a full Pandamate shutdown…";

  function publish(
    nextPhase: FleetShutdownPhase = phase,
    nextHeadline: string = headline,
  ): FleetShutdownReport {
    phase = nextPhase;
    headline = nextHeadline;
    const report: FleetShutdownReport = {
      phase,
      headline: headline.slice(0, 240),
      sessions: [...steps.values()],
      foreign: plan.foreign,
    };
    options.onProgress?.(report);
    return report;
  }

  function record(
    session: string,
    outcome: FleetSessionOutcome,
    detail: string,
  ): void {
    steps.set(session, { session, outcome, detail: detail.slice(0, 200) });
  }

  function stillRunning(): readonly string[] {
    return [...steps.values()]
      .filter(
        (step) => step.outcome === "requested" || step.outcome === "failed",
      )
      .map((step) => step.session);
  }

  try {
    plan = planFleetShutdown(discoverTmuxSessions(tmux));
  } catch (error) {
    return publish("failed", `Could not read tmux sessions: ${message(error)}`);
  }

  if (options.daemon) {
    publish("draining", "Draining the Pandamate daemon…");
    try {
      publish("draining", await options.daemon.drain());
    } catch (error) {
      return publish(
        "failed",
        `Daemon drain failed, so FirstMates would be restarted: ${message(error)}`,
      );
    }
  }

  publish(
    "firstmates",
    plan.firstMates.length === 0
      ? "No FirstMates are running."
      : `Asking ${plan.firstMates.length} FirstMate${plan.firstMates.length === 1 ? "" : "s"} to shut down gracefully…`,
  );
  for (const session of plan.firstMates) {
    try {
      const request = requestGracefulSessionShutdown(tmux, session);
      record(session, "requested", `Shutdown sent to window 0 (${request.pane})`);
    } catch (error) {
      record(session, "failed", `Could not deliver the shutdown: ${message(error)}`);
    }
    publish();
  }

  const deadline = now() + graceMilliseconds;
  while (stillRunning().length > 0 && now() < deadline) {
    await sleep(pollMilliseconds);
    const live = liveSessionNames(tmux);
    if (!live) {
      continue;
    }
    let changed = false;
    for (const session of stillRunning()) {
      if (!live.has(session)) {
        record(session, "closed", "Closed itself gracefully");
        changed = true;
      }
    }
    if (changed) {
      const remaining = stillRunning().length;
      publish(
        "firstmates",
        remaining === 0
          ? "Every FirstMate closed itself."
          : `Waiting for ${remaining} FirstMate${remaining === 1 ? "" : "s"} to finish…`,
      );
    }
  }

  // One last look before forcing anything: a FirstMate can close between the
  // final poll and the deadline — or so promptly that delivering the request
  // itself failed — and killing a session that already left would report a
  // graceful close as a forced one.
  const surviving = liveSessionNames(tmux);
  for (const session of stillRunning()) {
    if (surviving && !surviving.has(session)) {
      record(session, "closed", "Closed itself gracefully");
      continue;
    }
    if (!force) {
      record(session, "left-running", "Still running when the grace period ended");
      continue;
    }
    try {
      // Same order the supervisor uses: unlink the home tab first, because
      // killing a session whose window is still linked leaves the FirstMate's
      // pane alive inside pandamate:home.
      closeControlTab(tmux, session);
      tmux.killSession(session);
      record(session, "forced", "Did not finish in time; session stopped");
    } catch (error) {
      record(session, "failed", `Could not stop the session: ${message(error)}`);
    }
  }
  if (plan.firstMates.length > 0) {
    publish();
  }

  if (options.daemon) {
    publish("daemon", "Stopping the Pandamate daemon…");
    try {
      publish("daemon", await options.daemon.stop());
    } catch (error) {
      publish("daemon", `Daemon did not stop cleanly: ${message(error)}`);
    }
  }

  const closed = [...steps.values()].filter(
    (step) => step.outcome === "closed",
  ).length;
  const forced = [...steps.values()].filter(
    (step) => step.outcome === "forced",
  ).length;
  const unresolved = [...steps.values()].filter(
    (step) => step.outcome === "failed" || step.outcome === "left-running",
  ).length;
  return publish(
    "closed",
    [
      `${closed} FirstMate${closed === 1 ? "" : "s"} closed gracefully`,
      forced > 0 ? `${forced} forced` : null,
      unresolved > 0 ? `${unresolved} still open` : null,
      plan.foreign.length > 0
        ? `${plan.foreign.length} foreign tmux session${plan.foreign.length === 1 ? "" : "s"} left untouched`
        : null,
    ]
      .filter((part): part is string => part !== null)
      .join(" · "),
  );
}

/**
 * End Pandamate's own tmux sessions, `pandamate:home` last of all: home hosts
 * the TUI and the launcher that usually drives the shutdown, so killing it is
 * the final act and never returns for that caller.
 */
export function closePandamateSessions(
  tmux: Pick<TmuxClient, "run" | "resolveSession" | "killSession">,
  options: { readonly includeHome?: boolean } = {},
): ControlSessionTeardown {
  const plan = planFleetShutdown(discoverTmuxSessions(tmux));
  const closed: string[] = [];
  const failed: string[] = [];
  for (const service of plan.services) {
    try {
      tmux.killSession(service);
      closed.push(service);
    } catch {
      failed.push(service);
    }
  }
  if (options.includeHome !== false && plan.home) {
    closed.push(plan.home);
    tmux.killSession(plan.home);
  }
  return { closed, failed };
}
