import { createConnection } from "node:net";

import {
  encodeFrame,
  maximumFrameBytes,
  parseResponseFrame,
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
