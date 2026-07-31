import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { protocolVersion, type Request } from "@pandamate/protocol";

import { requestDaemon } from "./index.ts";

test("correlates a response over a Unix socket", async () => {
  const directory = mkdtempSync(join(tmpdir(), "pandamate-client-"));
  const socketPath = join(directory, "daemon.sock");
  const server = createServer((socket) => {
    socket.once("data", () => {
      socket.end(
        `${JSON.stringify({
          protocol: protocolVersion,
          requestId: "req_test_123",
          ok: true,
          data: { pong: true, pid: 42 },
        })}\n`,
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(socketPath, resolve));
  const request: Request = {
    protocol: protocolVersion,
    requestId: "req_test_123",
    type: "system.ping",
    payload: {},
  };
  try {
    const response = await requestDaemon(socketPath, request);
    assert.equal(response.ok, true);
    if (response.ok) {
      assert.deepEqual(response.data, { pong: true, pid: 42 });
    }
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    rmSync(directory, { recursive: true, force: true });
  }
});
