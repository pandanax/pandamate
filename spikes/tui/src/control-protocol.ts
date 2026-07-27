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
  | "pandamate.reload";
export type SessionTuiAction = Exclude<
  TuiAction,
  "pandamate.submit" | "pandamate.reload"
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
    };

export interface TuiActionResult {
  readonly type: "action.result";
  readonly action: TuiAction;
  readonly sessionName?: string;
  readonly success: boolean;
  readonly message: string;
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
    value === "pandamate.reload"
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
    (candidate.action !== "pandamate.submit" &&
      candidate.action !== "pandamate.reload" &&
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
