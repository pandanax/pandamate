#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { accessSync, constants, statSync } from "node:fs";
import { isAbsolute, normalize } from "node:path";

import {
  DaemonUnavailableError,
  requestDaemon,
} from "@pandamate/client";
import { loadConfig } from "@pandamate/config";
import {
  buildProjectOnboarding,
  type EventRecord,
  type Message,
  type MessagePriority,
  type Project,
  type ProjectKind,
} from "@pandamate/domain";
import { HookSpoolClient } from "@pandamate/firstmate-kit";
import {
  protocolVersion,
  type Request,
  type Response,
  type ResponseData,
} from "@pandamate/protocol";

import { formatEvents, formatProjects } from "./format.ts";

const config = loadConfig();
const arguments_ = process.argv.slice(2);
const json = arguments_.includes("--json");
const args = arguments_.filter(
  (argument) => argument !== "--json" && argument !== "--",
);

function usage(): never {
  process.stderr.write(`Usage:
  pandamate daemon start|stop|status
  pandamate status [--json]
  pandamate start|stop|restart|open <project> [--json]
  pandamate send <project> <instruction...> [--priority normal|high|urgent] [--json]
  pandamate inbox list [project] [--json]
  pandamate inbox lease <project> <owner> [--json]
  pandamate inbox ack|apply|resolve|fail <message-id> <owner> <summary...> [--json]
  pandamate timer add <project> <ISO-due-at> <instruction...> [--priority normal|high|urgent]
  pandamate timer list [project] [--json]
  pandamate event <project> <hook-id> <event-type> [payload-json]
  pandamate memory set <topic> <value> <summary> [source]
  pandamate memory list [--history] [--json]
  pandamate memory check [--json]
  pandamate project add <slug> <title> <arc|git|docs> <absolute-workspace>
  pandamate project create <FirstMateArc|FirstMateGit|DocResearch> <absolute-workspace> [title]
  pandamate project adopt <slug> <tmux-session> [--json]
  pandamate project show <slug> [--json]
  pandamate events [--after <sequence>] [--limit <count>] [--json]
  pandamate doctor [--json]
`);
  process.exit(2);
}

function requestId(): string {
  return `req_${randomUUID()}`;
}

async function send(request: Request): Promise<ResponseData> {
  const response = await requestDaemon(config.socketPath, request);
  if (!response.ok) {
    throw new Error(`${response.error.code}: ${response.error.message}`);
  }
  return response.data;
}

function objectData(data: ResponseData): Record<string, unknown> {
  return data as unknown as Record<string, unknown>;
}

function projectsFrom(data: ResponseData): readonly Project[] {
  const projects = objectData(data).projects;
  if (!Array.isArray(projects)) {
    throw new Error("Daemon returned an invalid project projection");
  }
  return projects as readonly Project[];
}

function projectFrom(data: ResponseData): Project {
  const project = objectData(data).project;
  if (typeof project !== "object" || project === null) {
    throw new Error("Daemon returned an invalid project");
  }
  return project as Project;
}

function eventsFrom(data: ResponseData): readonly EventRecord[] {
  const events = objectData(data).events;
  if (!Array.isArray(events)) {
    throw new Error("Daemon returned an invalid event projection");
  }
  return events as readonly EventRecord[];
}

function messageFrom(data: ResponseData): Message {
  const message = objectData(data).message;
  if (typeof message !== "object" || message === null) {
    throw new Error("Daemon returned an invalid message");
  }
  return message as Message;
}

function messagesFrom(data: ResponseData): readonly Message[] {
  const messages = objectData(data).messages;
  if (!Array.isArray(messages)) {
    throw new Error("Daemon returned an invalid message projection");
  }
  return messages as readonly Message[];
}

function output(value: unknown, human: string): void {
  process.stdout.write(json ? `${JSON.stringify(value, null, 2)}\n` : human);
}

async function ping(): Promise<{ readonly pid: number }> {
  const data = objectData(
    await send({
      protocol: protocolVersion,
      requestId: requestId(),
      type: "system.ping",
      payload: {},
    }),
  );
  if (
    data.pong !== true ||
    typeof data.pid !== "number" ||
    !Number.isSafeInteger(data.pid)
  ) {
    throw new Error("Daemon returned an invalid ping response");
  }
  return { pid: data.pid };
}

async function waitForDaemon(): Promise<{ readonly pid: number }> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      return await ping();
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("Pandamate daemon did not start");
}

async function daemonCommand(action: string | undefined): Promise<void> {
  if (action === "start") {
    try {
      const running = await ping();
      output(running, `Pandamate daemon already running (PID ${running.pid}).\n`);
      return;
    } catch (error) {
      if (!(error instanceof DaemonUnavailableError)) {
        throw error;
      }
    }
    const daemonEntry = new URL("../../daemon/src/main.ts", import.meta.url);
    const child = spawn(process.execPath, [daemonEntry.pathname], {
      detached: true,
      env: process.env,
      stdio: "ignore",
    });
    child.unref();
    const running = await waitForDaemon();
    output(running, `Pandamate daemon started (PID ${running.pid}).\n`);
    return;
  }
  if (action === "stop") {
    await send({
      protocol: protocolVersion,
      requestId: requestId(),
      type: "system.shutdown",
      payload: {},
    });
    output({ stopped: true }, "Pandamate daemon stopping.\n");
    return;
  }
  if (action === "status") {
    const running = await ping();
    output(
      { running: true, ...running, socketPath: config.socketPath },
      `Pandamate daemon running (PID ${running.pid}).\n`,
    );
    return;
  }
  usage();
}

async function statusCommand(): Promise<void> {
  const projects = projectsFrom(
    await send({
      protocol: protocolVersion,
      requestId: requestId(),
      type: "project.list",
      payload: {},
    }),
  );
  output({ projects }, formatProjects(projects));
}

async function lifecycleCommand(
  action: "start" | "stop" | "restart" | "open",
): Promise<void> {
  const slug = args[1];
  if (!slug) {
    usage();
  }
  if (action === "open") {
    const project = projectFrom(
      await send({
        protocol: protocolVersion,
        requestId: requestId(),
        type: "project.open",
        payload: { slug },
      }),
    );
    output(
      { project, target: project.tmuxTarget },
      `Opened ${project.slug}: ${project.tmuxSessionName ?? project.tmuxTarget}\n`,
    );
    return;
  }
  if (action === "restart") {
    const project = projectFrom(
      await send({
        protocol: protocolVersion,
        requestId: requestId(),
        type: "project.restart",
        idempotencyKey: `cli:${randomUUID()}`,
        payload: { slug },
      }),
    );
    output(
      project,
      `${project.slug} restart requested; actual state: ${project.actualState}.\n`,
    );
    return;
  }
  const project = projectFrom(
    await send({
      protocol: protocolVersion,
      requestId: requestId(),
      type: "project.desired.set",
      idempotencyKey: `cli:${randomUUID()}`,
      payload: {
        slug,
        desiredState: action === "start" ? "running" : "stopped",
      },
    }),
  );
  output(
    project,
    `${project.slug} desired state: ${project.desiredState}; actual state: ${project.actualState}.\n`,
  );
}

async function projectCommand(): Promise<void> {
  const action = args[1];
  if (action === "create") {
    const profile = args[2];
    const workspace = args[3];
    const title = args[4];
    if (!profile || !workspace) {
      usage();
    }
    if (!statSync(workspace).isDirectory()) {
      throw new Error(`Workspace is not a directory: ${workspace}`);
    }
    const onboarding = buildProjectOnboarding(profile, workspace, title);
    await send({
      protocol: protocolVersion,
      requestId: requestId(),
      type: "project.create",
      idempotencyKey: `cli:${randomUUID()}`,
      payload: onboarding.project,
    });
    const project = projectFrom(
      await send({
        protocol: protocolVersion,
        requestId: requestId(),
        type: "project.desired.set",
        idempotencyKey: `cli:${randomUUID()}`,
        payload: {
          slug: onboarding.project.slug,
          desiredState: "running",
        },
      }),
    );
    output(
      { profile: onboarding.profile, project },
      `Created ${project.slug} as ${onboarding.profile}; FirstMate start requested in ${project.workspace}.\n`,
    );
    return;
  }
  if (action === "add") {
    const [, , slug, title, kind, workspace] = args;
    if (
      !slug ||
      !title ||
      (kind !== "arc" && kind !== "git" && kind !== "docs") ||
      !workspace
    ) {
      usage();
    }
    const project = projectFrom(
      await send({
        protocol: protocolVersion,
        requestId: requestId(),
        type: "project.create",
        idempotencyKey: `cli:${randomUUID()}`,
        payload: {
          slug,
          title,
          kind: kind as ProjectKind,
          workspace,
        },
      }),
    );
    output(project, `Registered ${project.slug} (${project.kind}).\n`);
    return;
  }
  if (action === "show") {
    const slug = args[2];
    if (!slug) {
      usage();
    }
    const project = projectFrom(
      await send({
        protocol: protocolVersion,
        requestId: requestId(),
        type: "project.get",
        payload: { slug },
      }),
    );
    output(project, formatProjects([project]));
    return;
  }
  if (action === "adopt") {
    const slug = args[2];
    const sessionName = args[3];
    if (!slug || !sessionName) {
      usage();
    }
    const project = projectFrom(
      await send({
        protocol: protocolVersion,
        requestId: requestId(),
        type: "project.tmux.adopt",
        idempotencyKey: `cli:${randomUUID()}`,
        payload: { slug, sessionName },
      }),
    );
    output(
      project,
      `Adopted tmux session ${sessionName} for ${project.slug} as ${project.tmuxTarget}.\n`,
    );
    return;
  }
  usage();
}

function numericOption(name: string, fallback: number): number {
  const index = args.indexOf(name);
  if (index === -1) {
    return fallback;
  }
  const value = Number(args[index + 1]);
  if (!Number.isSafeInteger(value)) {
    usage();
  }
  return value;
}

async function eventsCommand(): Promise<void> {
  const after = numericOption("--after", 0);
  const limit = numericOption("--limit", 100);
  const events = eventsFrom(
    await send({
      protocol: protocolVersion,
      requestId: requestId(),
      type: "event.list",
      payload: { after, limit },
    }),
  );
  output({ events }, formatEvents(events));
}

function optionValue(name: string): string | undefined {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

async function sendCommand(): Promise<void> {
  const slug = args[1];
  const priority = (optionValue("--priority") ?? "normal") as MessagePriority;
  const optionIndex = args.indexOf("--priority");
  const textParts = args.slice(2, optionIndex === -1 ? undefined : optionIndex);
  if (
    !slug ||
    textParts.length === 0 ||
    !["normal", "high", "urgent"].includes(priority)
  ) {
    usage();
  }
  const message = messageFrom(
    await send({
      protocol: protocolVersion,
      requestId: requestId(),
      type: "message.create",
      idempotencyKey: `cli:${randomUUID()}`,
      payload: {
        projectSlug: slug,
        text: textParts.join(" "),
        priority,
      },
    }),
  );
  output(
    message,
    `Queued ${message.priority} instruction ${message.id} for ${message.projectSlug}.\n`,
  );
}

async function inboxCommand(): Promise<void> {
  const action = args[1];
  if (action === "list") {
    const messages = messagesFrom(
      await send({
        protocol: protocolVersion,
        requestId: requestId(),
        type: "message.list",
        payload: {
          ...(args[2] ? { projectSlug: args[2] } : {}),
          limit: 100,
        },
      }),
    );
    output(
      { messages },
      messages.length === 0
        ? "No messages.\n"
        : `${messages
            .map(
              (message) =>
                `${message.id}  ${message.projectSlug}  ${message.priority}  ${message.status}  ${message.text}`,
            )
            .join("\n")}\n`,
    );
    return;
  }
  if (action === "lease") {
    const projectSlug = args[2];
    const leaseOwner = args[3];
    if (!projectSlug || !leaseOwner) {
      usage();
    }
    const messages = messagesFrom(
      await send({
        protocol: protocolVersion,
        requestId: requestId(),
        type: "message.lease",
        payload: {
          projectSlug,
          leaseOwner,
          leaseMilliseconds: 60_000,
          limit: 10,
        },
      }),
    );
    output(
      { messages },
      messages.length === 0
        ? "No pending instructions.\n"
        : `${messages
            .map((message) => `${message.id}  ${message.priority}  ${message.text}`)
            .join("\n")}\n`,
    );
    return;
  }
  const statusByAction = {
    ack: "acknowledged",
    apply: "applied",
    resolve: "resolved",
    fail: "failed",
  } as const;
  const status =
    action && action in statusByAction
      ? statusByAction[action as keyof typeof statusByAction]
      : undefined;
  const messageId = args[2];
  const leaseOwner = args[3];
  const summary = args.slice(4).join(" ");
  if (!status || !messageId || !leaseOwner || !summary) {
    usage();
  }
  const message = messageFrom(
    await send({
      protocol: protocolVersion,
      requestId: requestId(),
      type: "message.transition",
      payload: {
        messageId,
        leaseOwner,
        status,
        summary,
      },
    }),
  );
  output(message, `${message.id}: ${message.status}.\n`);
}

async function timerCommand(): Promise<void> {
  const action = args[1];
  if (action === "list") {
    const data = objectData(
      await send({
        protocol: protocolVersion,
        requestId: requestId(),
        type: "timer.list",
        payload: {
          ...(args[2] ? { projectSlug: args[2] } : {}),
          limit: 100,
        },
      }),
    );
    const timers = data.timers;
    if (!Array.isArray(timers)) {
      throw new Error("Daemon returned an invalid timer projection");
    }
    output(
      { timers },
      timers.length === 0
        ? "No timers.\n"
        : `${timers
            .map((timer) => JSON.stringify(timer))
            .join("\n")}\n`,
    );
    return;
  }
  if (action === "add") {
    const projectSlug = args[2];
    const dueAt = args[3];
    const priority = (optionValue("--priority") ?? "normal") as MessagePriority;
    const optionIndex = args.indexOf("--priority");
    const text = args
      .slice(4, optionIndex === -1 ? undefined : optionIndex)
      .join(" ");
    if (
      !projectSlug ||
      !dueAt ||
      !text ||
      !["normal", "high", "urgent"].includes(priority)
    ) {
      usage();
    }
    const data = objectData(
      await send({
        protocol: protocolVersion,
        requestId: requestId(),
        type: "timer.create",
        idempotencyKey: `cli:${randomUUID()}`,
        payload: { projectSlug, dueAt, text, priority },
      }),
    );
    output(data.timer, `Timer scheduled for ${dueAt}.\n`);
    return;
  }
  usage();
}

async function hookEventCommand(): Promise<void> {
  const projectSlug = args[1];
  const hookId = args[2];
  const eventType = args[3];
  if (!projectSlug || !hookId || !eventType) {
    usage();
  }
  let payload: unknown = {};
  if (args[4]) {
    payload = JSON.parse(args[4]) as unknown;
  }
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new Error("Hook payload must be a JSON object");
  }
  const client = new HookSpoolClient({
    socketPath: config.socketPath,
    spoolDirectory: config.hookSpoolDirectory,
  });
  const replayed = await client.replay().catch(() => 0);
  const disposition = await client.ingest({
    projectSlug,
    hookId,
    eventType,
    occurredAt: new Date().toISOString(),
    payload: payload as Readonly<Record<string, unknown>>,
  });
  output(
    { disposition, replayed },
    `Hook ${hookId} ${disposition}; replayed ${replayed} prior hook(s).\n`,
  );
}

async function memoryCommand(): Promise<void> {
  const action = args[1];
  if (action === "set") {
    const topic = args[2];
    const value = args[3];
    const summary = args[4];
    const source = args[5] ?? "Panda via local CLI";
    if (!topic || !value || !summary) {
      usage();
    }
    const data = objectData(
      await send({
        protocol: protocolVersion,
        requestId: requestId(),
        type: "decision.record",
        idempotencyKey: `cli:${randomUUID()}`,
        payload: { topic, value, summary, source },
      }),
    );
    output(data.decision, `Recorded active decision ${topic}.\n`);
    return;
  }
  if (action === "list") {
    const data = objectData(
      await send({
        protocol: protocolVersion,
        requestId: requestId(),
        type: "decision.list",
        payload: { includeSuperseded: args.includes("--history") },
      }),
    );
    const decisions = data.decisions;
    if (!Array.isArray(decisions)) {
      throw new Error("Daemon returned an invalid decision projection");
    }
    output(
      { decisions },
      decisions.length === 0
        ? "No decisions.\n"
        : `${decisions
            .map(
              (decision) =>
                `${(decision as { topic: string }).topic}: ${(decision as { summary: string }).summary}`,
            )
            .join("\n")}\n`,
    );
    return;
  }
  if (action === "check") {
    const data = objectData(
      await send({
        protocol: protocolVersion,
        requestId: requestId(),
        type: "memory.check",
        payload: {},
      }),
    );
    const check = data.memoryCheck as
      | {
          readonly ok: boolean;
          readonly expectedChecksum: string;
          readonly actualChecksum: string | null;
        }
      | undefined;
    if (!check) {
      throw new Error("Daemon returned an invalid memory check");
    }
    output(check, check.ok ? "Memory is consistent.\n" : "Memory drift detected.\n");
    if (!check.ok) {
      process.exitCode = 1;
    }
    return;
  }
  usage();
}

async function doctorCommand(): Promise<void> {
  const checks: Array<{
    name: string;
    ok: boolean;
    detail: string;
  }> = [];
  checks.push({
    name: "node",
    ok: Number(process.versions.node.split(".")[0]) >= 26,
    detail: process.versions.node,
  });
  checks.push({
    name: "state-directory",
    ok: isAbsolute(config.stateDirectory) &&
      normalize(config.stateDirectory) === config.stateDirectory,
    detail: config.stateDirectory,
  });
  try {
    accessSync(config.runtimeDirectory, constants.R_OK | constants.W_OK);
    checks.push({
      name: "runtime-directory",
      ok: true,
      detail: config.runtimeDirectory,
    });
  } catch {
    checks.push({
      name: "runtime-directory",
      ok: false,
      detail: `${config.runtimeDirectory} is not accessible`,
    });
  }
  try {
    const running = await ping();
    checks.push({
      name: "daemon",
      ok: true,
      detail: `PID ${running.pid}`,
    });
  } catch (error) {
    checks.push({
      name: "daemon",
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    });
  }
  const ok = checks.every((check) => check.ok);
  output(
    { ok, checks },
    `${checks
      .map((check) => `${check.ok ? "✓" : "✗"} ${check.name}: ${check.detail}`)
      .join("\n")}\n`,
  );
  if (!ok) {
    process.exitCode = 1;
  }
}

try {
  switch (args[0]) {
    case "daemon":
      await daemonCommand(args[1]);
      break;
    case "status":
      await statusCommand();
      break;
    case "start":
    case "stop":
    case "restart":
    case "open":
      await lifecycleCommand(args[0]);
      break;
    case "project":
      await projectCommand();
      break;
    case "events":
      await eventsCommand();
      break;
    case "send":
      await sendCommand();
      break;
    case "inbox":
      await inboxCommand();
      break;
    case "timer":
      await timerCommand();
      break;
    case "event":
      await hookEventCommand();
      break;
    case "memory":
      await memoryCommand();
      break;
    case "doctor":
      await doctorCommand();
      break;
    default:
      usage();
  }
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
}
