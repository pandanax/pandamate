import { appendFileSync, chmodSync, unlinkSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";

import type { PandamateConfig } from "@pandamate/config";
import {
  encodeFrame,
  maximumFrameBytes,
  parseFrame,
  protocolVersion,
  type Request,
  type Response,
  type ResponseData,
} from "@pandamate/protocol";
import {
  discoverTmuxSessions,
  closeControlTab,
  openSessionAsControlTab,
  type TmuxClient,
} from "@pandamate/runtime-tmux";
import type { PandamateStore } from "@pandamate/storage";
import { MemoryMaterializer } from "@pandamate/memory";

export interface DaemonServer {
  readonly server: Server;
  readonly close: () => Promise<void>;
}

function safeMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message.slice(0, 240);
  }
  return "Unknown daemon error";
}

function errorCode(error: unknown): string {
  const message = safeMessage(error);
  if (message.includes("UNIQUE constraint failed: projects.slug")) {
    return "project_already_exists";
  }
  if (message.includes("Unknown project")) {
    return "project_not_found";
  }
  if (message.includes("Unknown tmux session")) {
    return "tmux_session_not_found";
  }
  if (message.includes("already associated")) {
    return "tmux_session_already_associated";
  }
  return "invalid_request";
}

function response(
  requestId: string,
  handler: () => ResponseData,
): Response {
  try {
    return {
      protocol: protocolVersion,
      requestId,
      ok: true,
      data: handler(),
    };
  } catch (error) {
    return {
      protocol: protocolVersion,
      requestId,
      ok: false,
      error: {
        code: errorCode(error),
        message: safeMessage(error),
      },
    };
  }
}

function handleRequest(
  request: Request,
  store: PandamateStore,
  requestShutdown: () => void,
  tmux: Pick<TmuxClient, "run" | "resolveSession">,
  openSession: (
    tmux: Pick<TmuxClient, "run" | "resolveSession">,
    sessionName: string,
  ) => string,
  closeSession: (
    tmux: Pick<TmuxClient, "run" | "resolveSession">,
    sessionName: string,
  ) => boolean,
  memory: MemoryMaterializer,
): Response {
  switch (request.type) {
    case "system.ping":
      return response(request.requestId, () => ({
        pong: true,
        pid: process.pid,
      }));
    case "system.shutdown":
      return response(request.requestId, () => {
        requestShutdown();
        return { shuttingDown: true };
      });
    case "project.list":
      return response(request.requestId, () => ({
        projects: store.listProjects(),
      }));
    case "project.get":
      return response(request.requestId, () => {
        const project = store.getProject(request.payload.slug);
        if (!project) {
          throw new Error(`Unknown project: ${request.payload.slug}`);
        }
        return { project };
      });
    case "project.open":
      return response(request.requestId, () => {
        const project = store.getProject(request.payload.slug);
        if (!project) {
          throw new Error(`Unknown project: ${request.payload.slug}`);
        }
        if (!project.tmuxSessionName) {
          throw new Error(`Project ${project.slug} has no running tmux session`);
        }
        openSession(tmux, project.tmuxSessionName);
        return { project };
      });
    case "project.tab.close":
      return response(request.requestId, () => {
        const project = store.getProject(request.payload.slug);
        if (!project) {
          throw new Error(`Unknown project: ${request.payload.slug}`);
        }
        if (!project.tmuxSessionName) {
          throw new Error(`Project ${project.slug} has no running tmux session`);
        }
        closeSession(tmux, project.tmuxSessionName);
        return { project };
      });
    case "project.create":
      return response(request.requestId, () => ({
        project: store.createProject(
          request.payload,
          request.idempotencyKey,
        ),
      }));
    case "project.desired.set":
      return response(request.requestId, () => ({
        project: store.setProjectDesiredState(
          request.payload.slug,
          request.payload.desiredState,
          request.idempotencyKey,
        ),
      }));
    case "project.tmux.adopt":
      return response(request.requestId, () => {
        const session = discoverTmuxSessions(tmux).find(
          (candidate) => candidate.name === request.payload.sessionName,
        );
        if (!session) {
          throw new Error(
            `Unknown tmux session: ${request.payload.sessionName}`,
          );
        }
        if (session.livePaneCount < 1) {
          throw new Error(
            `Tmux session ${session.name} has no live panes`,
          );
        }
        return {
          project: store.adoptProjectTmuxSession(
            request.payload.slug,
            session.id,
            session.name,
            session.livePaneCount,
            request.idempotencyKey,
          ),
        };
      });
    case "project.restart":
      return response(request.requestId, () => ({
        project: store.requestProjectRestart(
          request.payload.slug,
          request.idempotencyKey,
        ),
      }));
    case "event.list": {
      return response(request.requestId, () => {
        const events = store.listEvents(
          request.payload.after,
          request.payload.limit,
        );
        return {
          events,
          nextCursor:
            events.length === 0
              ? request.payload.after
              : (events.at(-1)?.sequence ?? request.payload.after),
        };
      });
    }
    case "message.create":
      return response(request.requestId, () => ({
        message: store.createMessage(
          request.payload,
          request.idempotencyKey,
        ),
      }));
    case "message.list":
      return response(request.requestId, () => ({
        messages: store.listMessages(
          request.payload.projectSlug,
          request.payload.limit,
        ),
      }));
    case "message.lease":
      return response(request.requestId, () => ({
        messages: store.leaseMessages(
          request.payload.projectSlug,
          request.payload.leaseOwner,
          request.payload.leaseMilliseconds,
          request.payload.limit,
        ),
      }));
    case "message.transition":
      return response(request.requestId, () => ({
        message: store.transitionMessage(
          request.payload.messageId,
          request.payload.leaseOwner,
          request.payload.status,
          request.payload.summary,
        ),
      }));
    case "firstmate.status.report":
      return response(request.requestId, () => ({
        status: store.reportFirstMateStatus(request.payload),
      }));
    case "checkpoint.create":
      return response(request.requestId, () => ({
        checkpoint: store.createCheckpoint(request.payload),
      }));
    case "timer.create":
      return response(request.requestId, () => ({
        timer: store.createTimer(request.payload, request.idempotencyKey),
      }));
    case "timer.list":
      return response(request.requestId, () => ({
        timers: store.listTimers(
          request.payload.projectSlug,
          request.payload.limit,
        ),
      }));
    case "hook.ingest":
      return response(request.requestId, () => ({
        event: store.ingestHook(request.payload),
      }));
    case "decision.record":
      return response(request.requestId, () => {
        const decision = store.recordDecision(
          request.payload,
          request.idempotencyKey,
        );
        memory.materialize(store.listDecisions());
        return { decision };
      });
    case "decision.list":
      return response(request.requestId, () => ({
        decisions: store.listDecisions(!request.payload.includeSuperseded),
      }));
    case "memory.check":
      return response(request.requestId, () => ({
        memoryCheck: memory.check(store.listDecisions()),
      }));
  }
}

function log(
  config: PandamateConfig,
  level: "info" | "error",
  event: string,
  fields: Readonly<Record<string, unknown>> = {},
): void {
  appendFileSync(
    config.logPath,
    `${JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      event,
      pid: process.pid,
      ...fields,
    })}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
}

function removeSocket(socketPath: string): void {
  try {
    unlinkSync(socketPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
}

export async function startServer(
  config: PandamateConfig,
  store: PandamateStore,
  onShutdown: () => void,
  tmux: Pick<TmuxClient, "run" | "resolveSession">,
  openSession: (
    tmux: Pick<TmuxClient, "run" | "resolveSession">,
    sessionName: string,
  ) => string = openSessionAsControlTab,
  closeSession: (
    tmux: Pick<TmuxClient, "run" | "resolveSession">,
    sessionName: string,
  ) => boolean = closeControlTab,
): Promise<DaemonServer> {
  removeSocket(config.socketPath);
  const memory = new MemoryMaterializer(config.memoryDirectory);
  memory.materialize(store.listDecisions());
  let closing = false;
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.setEncoding("utf8");
    let buffer = "";
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      if (Buffer.byteLength(buffer) > maximumFrameBytes) {
        socket.destroy(new Error("Protocol frame exceeds maximum size"));
        return;
      }
      const newline = buffer.indexOf("\n");
      if (newline === -1) {
        return;
      }
      const frame = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      let result: Response;
      try {
        const request = parseFrame(frame);
        result = handleRequest(
          request,
          store,
          () => {
            setTimeout(onShutdown, 25);
          },
          tmux,
          openSession,
          closeSession,
          memory,
        );
      } catch (error) {
        result = {
          protocol: protocolVersion,
          requestId: "unknown",
          ok: false,
          error: {
            code: "invalid_request",
            message: safeMessage(error),
          },
        };
      }
      socket.end(encodeFrame(result));
    });
    socket.on("error", (error) => {
      log(config, "error", "client.error", { message: safeMessage(error) });
    });
    socket.on("close", () => sockets.delete(socket));
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.socketPath, () => {
      server.off("error", reject);
      resolve();
    });
  });
  chmodSync(config.socketPath, 0o600);
  log(config, "info", "daemon.started", { socketPath: config.socketPath });

  return {
    server,
    close: async () => {
      if (closing) {
        return;
      }
      closing = true;
      for (const socket of sockets) {
        socket.destroy();
      }
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
      removeSocket(config.socketPath);
      log(config, "info", "daemon.stopped");
    },
  };
}
