import {
  validateAdoptTmuxSessionInput,
  validateCreateProjectInput,
  validateCreateMessageInput,
  validateCreateTimerInput,
  validateCheckpointInput,
  validateFirstMateStatus,
  validateHookInput,
  validateRecordDecisionInput,
  validateIdempotencyKey,
  validateProjectSlug,
  type CreateProjectInput,
  type AdoptTmuxSessionInput,
  type EventRecord,
  type Checkpoint,
  type FirstMateStatus,
  type Message,
  type Project,
  type Timer,
  type Decision,
} from "@pandamate/domain";

export const protocolVersion = 1 as const;
export const maximumFrameBytes = 1024 * 1024;

export type Request =
  | {
      readonly protocol: 1;
      readonly requestId: string;
      readonly type: "system.ping" | "system.shutdown";
      readonly payload: Readonly<Record<string, never>>;
    }
  | {
      readonly protocol: 1;
      readonly requestId: string;
      readonly type: "project.list";
      readonly payload: Readonly<Record<string, never>>;
    }
  | {
      readonly protocol: 1;
      readonly requestId: string;
      readonly type: "project.get";
      readonly payload: { readonly slug: string };
    }
  | {
      readonly protocol: 1;
      readonly requestId: string;
      readonly type: "project.open";
      readonly payload: { readonly slug: string };
    }
  | {
      readonly protocol: 1;
      readonly requestId: string;
      readonly type: "project.tab.close";
      readonly payload: { readonly slug: string };
    }
  | {
      readonly protocol: 1;
      readonly requestId: string;
      readonly type: "project.create";
      readonly idempotencyKey: string;
      readonly payload: CreateProjectInput;
    }
  | {
      readonly protocol: 1;
      readonly requestId: string;
      readonly type: "project.desired.set";
      readonly idempotencyKey: string;
      readonly payload: {
        readonly slug: string;
        readonly desiredState: "running" | "stopped";
      };
    }
  | {
      readonly protocol: 1;
      readonly requestId: string;
      readonly type: "project.tmux.adopt";
      readonly idempotencyKey: string;
      readonly payload: AdoptTmuxSessionInput;
    }
  | {
      readonly protocol: 1;
      readonly requestId: string;
      readonly type: "project.restart";
      readonly idempotencyKey: string;
      readonly payload: { readonly slug: string };
    }
  | {
      readonly protocol: 1;
      readonly requestId: string;
      readonly type: "event.list";
      readonly payload: { readonly after: number; readonly limit: number };
    }
  | {
      readonly protocol: 1;
      readonly requestId: string;
      readonly type: "message.create";
      readonly idempotencyKey: string;
      readonly payload: ReturnType<typeof validateCreateMessageInput>;
    }
  | {
      readonly protocol: 1;
      readonly requestId: string;
      readonly type: "message.list";
      readonly payload: {
        readonly projectSlug?: string;
        readonly limit: number;
      };
    }
  | {
      readonly protocol: 1;
      readonly requestId: string;
      readonly type: "message.lease";
      readonly payload: {
        readonly projectSlug: string;
        readonly leaseOwner: string;
        readonly leaseMilliseconds: number;
        readonly limit: number;
      };
    }
  | {
      readonly protocol: 1;
      readonly requestId: string;
      readonly type: "message.transition";
      readonly payload: {
        readonly messageId: string;
        readonly leaseOwner: string;
        readonly status: "acknowledged" | "applied" | "resolved" | "failed";
        readonly summary: string;
      };
    }
  | {
      readonly protocol: 1;
      readonly requestId: string;
      readonly type: "firstmate.status.report";
      readonly payload: FirstMateStatus;
    }
  | {
      readonly protocol: 1;
      readonly requestId: string;
      readonly type: "checkpoint.create";
      readonly payload: ReturnType<typeof validateCheckpointInput>;
    }
  | {
      readonly protocol: 1;
      readonly requestId: string;
      readonly type: "timer.create";
      readonly idempotencyKey: string;
      readonly payload: ReturnType<typeof validateCreateTimerInput>;
    }
  | {
      readonly protocol: 1;
      readonly requestId: string;
      readonly type: "timer.list";
      readonly payload: {
        readonly projectSlug?: string;
        readonly limit: number;
      };
    }
  | {
      readonly protocol: 1;
      readonly requestId: string;
      readonly type: "hook.ingest";
      readonly payload: ReturnType<typeof validateHookInput>;
    }
  | {
      readonly protocol: 1;
      readonly requestId: string;
      readonly type: "decision.record";
      readonly idempotencyKey: string;
      readonly payload: ReturnType<typeof validateRecordDecisionInput>;
    }
  | {
      readonly protocol: 1;
      readonly requestId: string;
      readonly type: "decision.list";
      readonly payload: { readonly includeSuperseded: boolean };
    }
  | {
      readonly protocol: 1;
      readonly requestId: string;
      readonly type: "memory.check";
      readonly payload: Readonly<Record<string, never>>;
    };

export type ResponseData =
  | { readonly pong: true; readonly pid: number }
  | { readonly shuttingDown: true }
  | { readonly projects: readonly Project[] }
  | { readonly project: Project }
  | { readonly events: readonly EventRecord[]; readonly nextCursor: number }
  | { readonly messages: readonly Message[] }
  | { readonly message: Message }
  | { readonly status: FirstMateStatus }
  | { readonly checkpoint: Checkpoint }
  | { readonly timer: Timer }
  | { readonly timers: readonly Timer[] }
  | { readonly event: EventRecord }
  | { readonly decision: Decision }
  | { readonly decisions: readonly Decision[] }
  | {
      readonly memoryCheck: {
        readonly ok: boolean;
        readonly expectedChecksum: string;
        readonly actualChecksum: string | null;
      };
    };

export type Response =
  | {
      readonly protocol: 1;
      readonly requestId: string;
      readonly ok: true;
      readonly data: ResponseData;
    }
  | {
      readonly protocol: 1;
      readonly requestId: string;
      readonly ok: false;
      readonly error: {
        readonly code: string;
        readonly message: string;
      };
    };

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function boundedString(value: unknown, label: string, maximum: number): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximum ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new Error(`Invalid ${label}`);
  }
  return value;
}

export function parseRequest(value: unknown): Request {
  const input = record(value, "Request");
  if (input.protocol !== protocolVersion) {
    throw new Error("Unsupported protocol version");
  }
  const requestId = boundedString(input.requestId, "request id", 120);
  const payload = record(input.payload, "Request payload");

  switch (input.type) {
    case "system.ping":
    case "system.shutdown":
    case "project.list":
    case "memory.check":
      return {
        protocol: protocolVersion,
        requestId,
        type: input.type,
        payload: {},
      };
    case "project.get":
    case "project.open":
    case "project.tab.close":
      return {
        protocol: protocolVersion,
        requestId,
        type: input.type,
        payload: { slug: validateProjectSlug(payload.slug) },
      };
    case "project.create":
      return {
        protocol: protocolVersion,
        requestId,
        type: input.type,
        idempotencyKey: validateIdempotencyKey(input.idempotencyKey),
        payload: validateCreateProjectInput(payload),
      };
    case "project.desired.set":
      if (
        payload.desiredState !== "running" &&
        payload.desiredState !== "stopped"
      ) {
        throw new Error("Invalid desired project state");
      }
      return {
        protocol: protocolVersion,
        requestId,
        type: input.type,
        idempotencyKey: validateIdempotencyKey(input.idempotencyKey),
        payload: {
          slug: validateProjectSlug(payload.slug),
          desiredState: payload.desiredState,
        },
      };
    case "project.tmux.adopt":
      return {
        protocol: protocolVersion,
        requestId,
        type: input.type,
        idempotencyKey: validateIdempotencyKey(input.idempotencyKey),
        payload: validateAdoptTmuxSessionInput(payload),
      };
    case "project.restart":
      return {
        protocol: protocolVersion,
        requestId,
        type: input.type,
        idempotencyKey: validateIdempotencyKey(input.idempotencyKey),
        payload: { slug: validateProjectSlug(payload.slug) },
      };
    case "event.list": {
      const after = payload.after;
      const limit = payload.limit;
      if (
        typeof after !== "number" ||
        !Number.isSafeInteger(after) ||
        after < 0 ||
        typeof limit !== "number" ||
        !Number.isSafeInteger(limit) ||
        limit < 1 ||
        limit > 500
      ) {
        throw new Error("Invalid event cursor or limit");
      }
      return {
        protocol: protocolVersion,
        requestId,
        type: input.type,
        payload: { after, limit },
      };
    }
    case "message.create":
      return {
        protocol: protocolVersion,
        requestId,
        type: input.type,
        idempotencyKey: validateIdempotencyKey(input.idempotencyKey),
        payload: validateCreateMessageInput(payload),
      };
    case "message.list": {
      const limit = payload.limit;
      if (
        typeof limit !== "number" ||
        !Number.isSafeInteger(limit) ||
        limit < 1 ||
        limit > 500
      ) {
        throw new Error("Invalid message query limit");
      }
      return {
        protocol: protocolVersion,
        requestId,
        type: input.type,
        payload: {
          ...(payload.projectSlug === undefined
            ? {}
            : { projectSlug: validateProjectSlug(payload.projectSlug) }),
          limit,
        },
      };
    }
    case "message.lease": {
      const leaseMilliseconds = payload.leaseMilliseconds;
      const limit = payload.limit;
      if (
        typeof leaseMilliseconds !== "number" ||
        !Number.isSafeInteger(leaseMilliseconds) ||
        leaseMilliseconds < 1_000 ||
        leaseMilliseconds > 300_000 ||
        typeof limit !== "number" ||
        !Number.isSafeInteger(limit) ||
        limit < 1 ||
        limit > 20
      ) {
        throw new Error("Invalid message lease bounds");
      }
      return {
        protocol: protocolVersion,
        requestId,
        type: input.type,
        payload: {
          projectSlug: validateProjectSlug(payload.projectSlug),
          leaseOwner: boundedString(payload.leaseOwner, "lease owner", 120),
          leaseMilliseconds,
          limit,
        },
      };
    }
    case "message.transition":
      if (
        payload.status !== "acknowledged" &&
        payload.status !== "applied" &&
        payload.status !== "resolved" &&
        payload.status !== "failed"
      ) {
        throw new Error("Invalid message transition status");
      }
      return {
        protocol: protocolVersion,
        requestId,
        type: input.type,
        payload: {
          messageId: boundedString(payload.messageId, "message id", 180),
          leaseOwner: boundedString(payload.leaseOwner, "lease owner", 120),
          status: payload.status,
          summary: boundedString(payload.summary, "transition summary", 1_000),
        },
      };
    case "firstmate.status.report":
      return {
        protocol: protocolVersion,
        requestId,
        type: input.type,
        payload: validateFirstMateStatus(payload),
      };
    case "checkpoint.create":
      return {
        protocol: protocolVersion,
        requestId,
        type: input.type,
        payload: validateCheckpointInput(payload),
      };
    case "timer.create":
      return {
        protocol: protocolVersion,
        requestId,
        type: input.type,
        idempotencyKey: validateIdempotencyKey(input.idempotencyKey),
        payload: validateCreateTimerInput(payload),
      };
    case "timer.list": {
      const limit = payload.limit;
      if (
        typeof limit !== "number" ||
        !Number.isSafeInteger(limit) ||
        limit < 1 ||
        limit > 500
      ) {
        throw new Error("Invalid timer query limit");
      }
      return {
        protocol: protocolVersion,
        requestId,
        type: input.type,
        payload: {
          ...(payload.projectSlug === undefined
            ? {}
            : { projectSlug: validateProjectSlug(payload.projectSlug) }),
          limit,
        },
      };
    }
    case "hook.ingest":
      return {
        protocol: protocolVersion,
        requestId,
        type: input.type,
        payload: validateHookInput(payload),
      };
    case "decision.record":
      return {
        protocol: protocolVersion,
        requestId,
        type: input.type,
        idempotencyKey: validateIdempotencyKey(input.idempotencyKey),
        payload: validateRecordDecisionInput(payload),
      };
    case "decision.list":
      if (typeof payload.includeSuperseded !== "boolean") {
        throw new Error("Invalid decision list option");
      }
      return {
        protocol: protocolVersion,
        requestId,
        type: input.type,
        payload: { includeSuperseded: payload.includeSuperseded },
      };
    default:
      throw new Error("Unknown request type");
  }
}

export function encodeFrame(value: Request | Response): string {
  const frame = `${JSON.stringify(value)}\n`;
  if (Buffer.byteLength(frame) > maximumFrameBytes) {
    throw new Error("Protocol frame exceeds maximum size");
  }
  return frame;
}

export function parseFrame(frame: string): Request {
  if (Buffer.byteLength(frame) > maximumFrameBytes) {
    throw new Error("Protocol frame exceeds maximum size");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(frame);
  } catch {
    throw new Error("Malformed JSON frame");
  }
  return parseRequest(parsed);
}

export function parseResponseFrame(frame: string): Response {
  if (Buffer.byteLength(frame) > maximumFrameBytes) {
    throw new Error("Protocol frame exceeds maximum size");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(frame);
  } catch {
    throw new Error("Malformed JSON frame");
  }
  const input = record(parsed, "Response");
  if (input.protocol !== protocolVersion) {
    throw new Error("Unsupported protocol version");
  }
  const requestId = boundedString(input.requestId, "request id", 120);
  if (input.ok === true) {
    const data = record(input.data, "Response data");
    return {
      protocol: protocolVersion,
      requestId,
      ok: true,
      data: data as ResponseData,
    };
  }
  if (input.ok === false) {
    const error = record(input.error, "Response error");
    return {
      protocol: protocolVersion,
      requestId,
      ok: false,
      error: {
        code: boundedString(error.code, "error code", 80),
        message: boundedString(error.message, "error message", 240),
      },
    };
  }
  throw new Error("Invalid response status");
}
