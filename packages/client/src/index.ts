import { randomUUID } from "node:crypto";
import { createConnection } from "node:net";

import {
  encodeFrame,
  maximumFrameBytes,
  parseResponseFrame,
  protocolVersion,
  type Request,
  type Response,
} from "@pandamate/protocol";

export class DaemonUnavailableError extends Error {
  override readonly name = "DaemonUnavailableError";
}

export async function requestDaemon(
  socketPath: string,
  request: Request,
  timeoutMilliseconds = 2_000,
): Promise<Response> {
  return await new Promise<Response>((resolve, reject) => {
    const socket = createConnection(socketPath);
    socket.setEncoding("utf8");
    socket.setTimeout(timeoutMilliseconds);
    let buffer = "";
    let settled = false;

    function fail(error: Error): void {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      reject(error);
    }

    socket.on("connect", () => {
      socket.write(encodeFrame(request));
    });
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      if (Buffer.byteLength(buffer) > maximumFrameBytes) {
        fail(new Error("Daemon response exceeds maximum frame size"));
        return;
      }
      const newline = buffer.indexOf("\n");
      if (newline === -1) {
        return;
      }
      try {
        const response = parseResponseFrame(buffer.slice(0, newline));
        if (response.requestId !== request.requestId) {
          throw new Error("Daemon response request ID does not match");
        }
        settled = true;
        socket.end();
        resolve(response);
      } catch (error) {
        fail(error instanceof Error ? error : new Error(String(error)));
      }
    });
    socket.on("timeout", () => {
      fail(new DaemonUnavailableError("Timed out waiting for Pandamate daemon"));
    });
    socket.on("error", (error: NodeJS.ErrnoException) => {
      fail(
        new DaemonUnavailableError(
          error.code === "ENOENT" || error.code === "ECONNREFUSED"
            ? "Pandamate daemon is not running"
            : error.message,
        ),
      );
    });
    socket.on("end", () => {
      if (!settled) {
        fail(new Error("Daemon closed the connection without a response"));
      }
    });
  });
}

export async function pingDaemon(socketPath: string): Promise<boolean> {
  const response = await requestDaemon(socketPath, {
    protocol: protocolVersion,
    requestId: `req_ping_${randomUUID()}`,
    type: "system.ping",
    payload: {},
  }).catch(() => null);
  return response?.ok === true;
}

export interface DaemonLifecycle {
  readonly drain: () => Promise<string>;
  readonly stop: () => Promise<string>;
}

/**
 * The two daemon calls a full Pandamate shutdown makes, in the shape the tmux
 * fleet orchestrator expects. A daemon that is already gone is reported, never
 * treated as a failure: with no daemon there is no supervisor left to bring
 * FirstMates back, which is exactly what draining is for.
 */
export function daemonLifecycle(socketPath: string): DaemonLifecycle {
  return {
    drain: async () => {
      const response = await requestDaemon(socketPath, {
        protocol: protocolVersion,
        requestId: `req_drain_${randomUUID()}`,
        type: "system.drain",
        payload: { draining: true },
      }).catch((error: unknown) => {
        if (error instanceof DaemonUnavailableError) {
          return null;
        }
        throw error;
      });
      if (response === null) {
        return "No daemon is running; nothing supervises the fleet.";
      }
      if (!response.ok) {
        throw new Error(response.error.message);
      }
      const projects = (response.data as { readonly projects?: unknown })
        .projects;
      const count = Array.isArray(projects) ? projects.length : 0;
      return `Daemon draining; ${count} project${count === 1 ? "" : "s"} marked stopped.`;
    },
    stop: async () => {
      const response = await requestDaemon(socketPath, {
        protocol: protocolVersion,
        requestId: `req_stop_${randomUUID()}`,
        type: "system.shutdown",
        payload: {},
      }).catch((error: unknown) => {
        if (error instanceof DaemonUnavailableError) {
          return null;
        }
        throw error;
      });
      if (response === null) {
        return "Daemon was already stopped.";
      }
      if (!response.ok) {
        throw new Error(response.error.message);
      }
      for (let attempt = 0; attempt < 40; attempt += 1) {
        if (!(await pingDaemon(socketPath))) {
          return "Daemon stopped.";
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw new Error("Daemon did not stop within four seconds");
    },
  };
}
