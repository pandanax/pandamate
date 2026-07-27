import {
  parseInjectedEvents,
  parseInjectedProjects,
  parseInjectedServices,
  type EventSummary,
  type ProjectSummary,
  type ServiceSummary,
} from "./model.ts";

export type TuiAction =
  | "session.open"
  | "session.graceful-shutdown"
  | "session.reset"
  | "session.kill"
  | "pandamate.submit"
  | "pandamate.reload"
  | "pandamate.shutdown-all";
export type SessionTuiAction = Exclude<
  TuiAction,
  "pandamate.submit" | "pandamate.reload" | "pandamate.shutdown-all"
>;

export type TuiActionRequest =
  | {
      readonly type: "action.request";
      readonly action: SessionTuiAction;
      readonly sessionName: string;
    }
  | {
      readonly type: "action.request";
      readonly action: "pandamate.submit";
      readonly text: string;
    }
  | {
      readonly type: "action.request";
      readonly action: "pandamate.reload";
    }
  | {
      readonly type: "action.request";
      readonly action: "pandamate.shutdown-all";
    };

export interface TuiActionResult {
  readonly type: "action.result";
  readonly action: TuiAction;
  readonly sessionName?: string;
  readonly success: boolean;
  readonly message: string;
}

export type ShutdownPhase =
  | "draining"
  | "firstmates"
  | "daemon"
  | "windows"
  | "closed"
  | "failed";

export type ShutdownSessionOutcome =
  | "requested"
  | "closed"
  | "forced"
  | "failed"
  | "left-running";

export interface ShutdownSessionStep {
  readonly session: string;
  readonly outcome: ShutdownSessionOutcome;
  readonly detail: string;
}

/**
 * Live progress of a full Pandamate shutdown. It is pushed rather than polled
 * because the daemon — the source of every other projection — is stopped
 * halfway through the sequence it describes.
 */
export interface TuiShutdownProgress {
  readonly type: "shutdown.progress";
  readonly phase: ShutdownPhase;
  readonly headline: string;
  readonly sessions: readonly ShutdownSessionStep[];
  readonly foreign: readonly string[];
}

export interface TuiProjectionUpdate {
  readonly type: "projection.update";
  readonly projects: readonly ProjectSummary[];
  readonly services: readonly ServiceSummary[];
  readonly events: readonly EventSummary[];
}

function isSafeSessionName(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 80 &&
    value !== "pandamate:home" &&
    value !== "pandamate:write" &&
    value !== "pandamate:idle-probe" &&
    value !== "pandamate:probe-keeper" &&
    !value.startsWith("pandamate:control-") &&
    !value.startsWith("pandamate:service-")
  );
}

function isTuiAction(value: unknown): value is TuiAction {
  return (
    value === "session.open" ||
    value === "session.graceful-shutdown" ||
    value === "session.reset" ||
    value === "session.kill" ||
    value === "pandamate.submit" ||
    value === "pandamate.reload" ||
    value === "pandamate.shutdown-all"
  );
}

function isPandamateAction(value: TuiAction): boolean {
  return (
    value === "pandamate.submit" ||
    value === "pandamate.reload" ||
    value === "pandamate.shutdown-all"
  );
}

export function parseTuiActionRequest(value: unknown): TuiActionRequest {
  if (typeof value !== "object" || value === null) {
    throw new Error("Invalid TUI action request");
  }
  const candidate = value as Record<string, unknown>;
  if (candidate.type !== "action.request" || !isTuiAction(candidate.action)) {
    throw new Error("Invalid TUI action request");
  }
  if (candidate.action === "pandamate.submit") {
    if (
      typeof candidate.text !== "string" ||
      candidate.text.trim().length === 0 ||
      candidate.text.length > 2048
    ) {
      throw new Error("Invalid Pandamate input");
    }
    return {
      type: "action.request",
      action: candidate.action,
      text: candidate.text,
    };
  }
  if (candidate.action === "pandamate.reload") {
    return { type: "action.request", action: candidate.action };
  }
  if (candidate.action === "pandamate.shutdown-all") {
    return { type: "action.request", action: candidate.action };
  }
  if (!isSafeSessionName(candidate.sessionName)) {
    throw new Error("Invalid TUI action request");
  }
  return {
    type: "action.request",
    action: candidate.action,
    sessionName: candidate.sessionName,
  };
}

export function parseTuiActionResult(value: unknown): TuiActionResult {
  if (typeof value !== "object" || value === null) {
    throw new Error("Invalid TUI action result");
  }
  const candidate = value as Record<string, unknown>;
  if (
    candidate.type !== "action.result" ||
    !isTuiAction(candidate.action) ||
    (!isPandamateAction(candidate.action) &&
      !isSafeSessionName(candidate.sessionName)) ||
    typeof candidate.success !== "boolean" ||
    typeof candidate.message !== "string" ||
    candidate.message.length > 240
  ) {
    throw new Error("Invalid TUI action result");
  }
  const result: TuiActionResult = {
    type: "action.result",
    action: candidate.action,
    success: candidate.success,
    message: candidate.message,
  };
  if (typeof candidate.sessionName === "string") {
    return { ...result, sessionName: candidate.sessionName };
  }
  return result;
}

const shutdownPhases = new Set<ShutdownPhase>([
  "draining",
  "firstmates",
  "daemon",
  "windows",
  "closed",
  "failed",
]);

const shutdownOutcomes = new Set<ShutdownSessionOutcome>([
  "requested",
  "closed",
  "forced",
  "failed",
  "left-running",
]);

function isShutdownSessionStep(value: unknown): value is ShutdownSessionStep {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.session === "string" &&
    candidate.session.length > 0 &&
    candidate.session.length <= 80 &&
    shutdownOutcomes.has(candidate.outcome as ShutdownSessionOutcome) &&
    typeof candidate.detail === "string" &&
    candidate.detail.length <= 240
  );
}

export function parseTuiShutdownProgress(value: unknown): TuiShutdownProgress {
  if (typeof value !== "object" || value === null) {
    throw new Error("Invalid Pandamate shutdown progress");
  }
  const candidate = value as Record<string, unknown>;
  if (
    candidate.type !== "shutdown.progress" ||
    !shutdownPhases.has(candidate.phase as ShutdownPhase) ||
    typeof candidate.headline !== "string" ||
    candidate.headline.length > 240 ||
    !Array.isArray(candidate.sessions) ||
    candidate.sessions.length > 100 ||
    !candidate.sessions.every(isShutdownSessionStep) ||
    !Array.isArray(candidate.foreign) ||
    candidate.foreign.length > 100 ||
    !candidate.foreign.every(
      (name: unknown) =>
        typeof name === "string" && name.length > 0 && name.length <= 80,
    )
  ) {
    throw new Error("Invalid Pandamate shutdown progress");
  }
  return {
    type: "shutdown.progress",
    phase: candidate.phase as ShutdownPhase,
    headline: candidate.headline,
    sessions: candidate.sessions as readonly ShutdownSessionStep[],
    foreign: candidate.foreign as readonly string[],
  };
}

export function parseTuiProjectionUpdate(
  value: unknown,
): TuiProjectionUpdate {
  if (typeof value !== "object" || value === null) {
    throw new Error("Invalid TUI projection update");
  }
  const candidate = value as Record<string, unknown>;
  if (
    candidate.type !== "projection.update" ||
    !Array.isArray(candidate.projects) ||
    !Array.isArray(candidate.services) ||
    !Array.isArray(candidate.events)
  ) {
    throw new Error("Invalid TUI projection update");
  }
  return {
    type: "projection.update",
    projects: parseInjectedProjects(JSON.stringify(candidate.projects)),
    services: parseInjectedServices(JSON.stringify(candidate.services)),
    events: parseInjectedEvents(JSON.stringify(candidate.events)),
  };
}
