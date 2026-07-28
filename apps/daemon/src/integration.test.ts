import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { requestDaemon } from "@pandamate/client";
import { loadConfig } from "@pandamate/config";
import {
  protocolVersion,
  type Request,
  type ResponseData,
} from "@pandamate/protocol";
import { controlTabForSession, TmuxClient } from "@pandamate/runtime-tmux";
import type { Message, Project } from "@pandamate/domain";

function requestId(): string {
  return `req_test_${randomUUID()}`;
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never;

async function request(
  socketPath: string,
  value: DistributiveOmit<Request, "requestId">,
): Promise<ResponseData> {
  const response = await requestDaemon(socketPath, {
    ...value,
    requestId: requestId(),
  } as Request);
  if (!response.ok) {
    throw new Error(response.error.message);
  }
  assert.equal(response.ok, true);
  return response.data;
}

async function waitForReady(
  child: ChildProcess,
  socketPath: string,
): Promise<void> {
  let earlyExit: Error | null = null;
  child.once("exit", (code, signal) => {
    earlyExit = new Error(
      `Daemon exited before ready: ${code ?? "signal"} ${signal ?? ""}`,
    );
  });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (earlyExit) {
      throw earlyExit;
    }
    try {
      await request(socketPath, {
        protocol: protocolVersion,
        type: "system.ping",
        payload: {},
      });
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  throw new Error("Daemon did not become ready");
}

async function stopDaemon(
  child: ChildProcess,
  socketPath: string,
): Promise<void> {
  const exited = new Promise<void>((resolve, reject) => {
    child.once("exit", (code, signal) => {
      if (code === 0 || signal === "SIGTERM") {
        resolve();
      } else {
        reject(new Error(`Daemon exit failed: ${code} ${signal}`));
      }
    });
  });
  await request(socketPath, {
    protocol: protocolVersion,
    type: "system.shutdown",
    payload: {},
  });
  await exited;
}

test("daemon restart preserves three projects and identical event history", async () => {
  const directory = mkdtempSync("/private/tmp/pandamate-daemon-");
  const environment = {
    ...process.env,
    PANDAMATE_STATE_DIR: join(directory, "state"),
    PANDAMATE_RUNTIME_DIR: join(directory, "runtime"),
  };
  const config = loadConfig(environment);
  const daemonEntry = new URL("./main.ts", import.meta.url);
  const launch = () =>
    spawn(process.execPath, [daemonEntry.pathname], {
      env: environment,
      stdio: "ignore",
    });
  let child = launch();

  try {
    await waitForReady(child, config.socketPath);
    const fixtures = [
      {
        slug: "mandala",
        title: "Mandala",
        kind: "git" as const,
        workspace: "/workspace/mandala",
      },
      {
        slug: "arc-1234",
        title: "ARC-1234",
        kind: "arc" as const,
        workspace: "/workspace/arcadia",
      },
      {
        slug: "legal",
        title: "Legal",
        kind: "docs" as const,
        workspace: "/workspace/legal",
      },
    ];
    for (const fixture of fixtures) {
      await request(config.socketPath, {
        protocol: protocolVersion,
        type: "project.create",
        idempotencyKey: `test:create:${fixture.slug}`,
        payload: fixture,
      });
    }
    const queuedData = await request(config.socketPath, {
      protocol: protocolVersion,
      type: "message.create",
      idempotencyKey: "test:message:mandala",
      payload: {
        projectSlug: "mandala",
        text: "Continue after daemon restart.",
        priority: "high",
      },
    });
    const queued = (
      queuedData as unknown as { readonly message: { readonly id: string } }
    ).message;
    await request(config.socketPath, {
      protocol: protocolVersion,
      type: "message.lease",
      payload: {
        projectSlug: "mandala",
        leaseOwner: "firstmate:mandala",
        leaseMilliseconds: 300_000,
        limit: 10,
      },
    });
    await request(config.socketPath, {
      protocol: protocolVersion,
      type: "decision.record",
      idempotencyKey: "test:decision:motion",
      payload: {
        topic: "ui.motion",
        value: "reduced",
        summary: "Use reduced motion.",
        source: "integration test",
      },
    });
    assert.match(
      readFileSync(join(config.memoryDirectory, "MEMORY.md"), "utf8"),
      /Use reduced motion\./,
    );
    const beforeProjects = await request(config.socketPath, {
      protocol: protocolVersion,
      type: "project.list",
      payload: {},
    });
    const beforeEvents = await request(config.socketPath, {
      protocol: protocolVersion,
      type: "event.list",
      payload: { after: 0, limit: 100 },
    });
    await stopDaemon(child, config.socketPath);

    child = launch();
    await waitForReady(child, config.socketPath);
    const afterProjects = await request(config.socketPath, {
      protocol: protocolVersion,
      type: "project.list",
      payload: {},
    });
    const afterEvents = await request(config.socketPath, {
      protocol: protocolVersion,
      type: "event.list",
      payload: { after: 0, limit: 100 },
    });

    assert.deepEqual(afterProjects, beforeProjects);
    assert.deepEqual(afterEvents, beforeEvents);
    const memoryCheck = await request(config.socketPath, {
      protocol: protocolVersion,
      type: "memory.check",
      payload: {},
    });
    assert.equal(
      (
        memoryCheck as unknown as {
          readonly memoryCheck: { readonly ok: boolean };
        }
      ).memoryCheck.ok,
      true,
    );
    for (const [status, summary] of [
      ["acknowledged", "Understood after restart."],
      ["applied", "Restored into the active plan."],
      ["resolved", "Completed once."],
    ] as const) {
      await request(config.socketPath, {
        protocol: protocolVersion,
        type: "message.transition",
        payload: {
          messageId: queued.id,
          leaseOwner: "firstmate:mandala",
          status,
          summary,
        },
      });
    }
    const messages = await request(config.socketPath, {
      protocol: protocolVersion,
      type: "message.list",
      payload: { projectSlug: "mandala", limit: 100 },
    });
    assert.equal(
      (
        messages as unknown as {
          readonly messages: readonly { readonly status: string }[];
        }
      ).messages[0]?.status,
      "resolved",
    );
    const events = (
      afterEvents as unknown as { readonly events: readonly unknown[] }
    ).events;
    assert.equal(events.length, 6);
    await stopDaemon(child, config.socketPath);
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
      await new Promise<void>((resolve) => child.once("exit", () => resolve()));
    }
    rmSync(directory, { recursive: true, force: true });
  }
});

async function waitForProjects(
  socketPath: string,
  predicate: (projects: readonly Project[]) => boolean,
): Promise<readonly Project[]> {
  let latest: readonly Project[] = [];
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const data = await request(socketPath, {
      protocol: protocolVersion,
      type: "project.list",
      payload: {},
    });
    latest = (
      data as unknown as { readonly projects: readonly Project[] }
    ).projects;
    if (predicate(latest)) {
      return latest;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Projects did not reconcile: ${JSON.stringify(latest)}`);
}

test("supervisor starts, stops, and recovers fake FirstMates on isolated tmux", async () => {
  const directory = mkdtempSync("/private/tmp/pandamate-supervisor-");
  const workspaceAlpha = join(directory, "alpha");
  const workspaceBeta = join(directory, "beta");
  mkdirSync(workspaceAlpha);
  mkdirSync(workspaceBeta);
  const socketName = `pandamate-test-${process.pid}-${Date.now()}`;
  const tmux = new TmuxClient({ socketName });
  tmux.createDetachedInDirectory(
    "pandamate:test-keeper",
    directory,
    ["/bin/sleep", "300"],
  );
  const fakeEntry = new URL(
    "../../../fixtures/fake-firstmate/src/main.ts",
    import.meta.url,
  ).pathname;
  const environment = {
    ...process.env,
    PANDAMATE_STATE_DIR: join(directory, "state"),
    PANDAMATE_RUNTIME_DIR: join(directory, "runtime"),
    PANDAMATE_TMUX_SOCKET_NAME: socketName,
    PANDAMATE_FIRSTMATE_ADAPTER: "fake",
    PANDAMATE_FAKE_FIRSTMATE_ENTRY: fakeEntry,
    PANDAMATE_RECONCILE_INTERVAL_MS: "100",
    PANDAMATE_HEARTBEAT_STALE_MS: "1000",
  };
  const config = loadConfig(environment);
  const daemonEntry = new URL("./main.ts", import.meta.url);
  let child = spawn(process.execPath, [daemonEntry.pathname], {
    env: environment,
    stdio: "ignore",
  });

  try {
    await waitForReady(child, config.socketPath);
    for (const project of [
      {
        slug: "alpha",
        title: "Alpha",
        kind: "git" as const,
        workspace: workspaceAlpha,
      },
      {
        slug: "beta",
        title: "Beta",
        kind: "docs" as const,
        workspace: workspaceBeta,
      },
    ]) {
      await request(config.socketPath, {
        protocol: protocolVersion,
        type: "project.create",
        idempotencyKey: `test:create:${project.slug}`,
        payload: project,
      });
      await request(config.socketPath, {
        protocol: protocolVersion,
        type: "project.desired.set",
        idempotencyKey: `test:start:${project.slug}`,
        payload: { slug: project.slug, desiredState: "running" },
      });
    }

    let projects = await waitForProjects(
      config.socketPath,
      (values) =>
        values.length === 2 &&
        values.every(
          (project) =>
            project.actualState === "running" &&
            project.lastHeartbeatAt !== null &&
            project.tmuxTarget !== null,
        ),
    );
    const alphaBefore = projects.find((project) => project.slug === "alpha");
    assert.ok(alphaBefore?.tmuxTarget);
    assert.equal(alphaBefore.tmuxSessionName, "firstmate-alpha");

    await request(config.socketPath, {
      protocol: protocolVersion,
      type: "message.create",
      idempotencyKey: "test:fixture-message:alpha",
      payload: {
        projectSlug: "alpha",
        text: "Resolve this through the public FirstMate kit.",
        priority: "urgent",
      },
    });
    let fixtureMessages: readonly Message[] = [];
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const data = await request(config.socketPath, {
        protocol: protocolVersion,
        type: "message.list",
        payload: { projectSlug: "alpha", limit: 10 },
      });
      fixtureMessages = (
        data as unknown as { readonly messages: readonly Message[] }
      ).messages;
      if (fixtureMessages[0]?.status === "resolved") {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.equal(fixtureMessages[0]?.status, "resolved");
    assert.equal(fixtureMessages[0]?.attempts, 1);

    tmux.killSession("firstmate-alpha");
    projects = await waitForProjects(
      config.socketPath,
      (values) => {
        const alpha = values.find((project) => project.slug === "alpha");
        return (
          alpha?.actualState === "running" &&
          alpha.tmuxTarget !== null &&
          alpha.tmuxTarget !== alphaBefore.tmuxTarget
        );
      },
    );
    assert.equal(
      projects.find((project) => project.slug === "alpha")?.desiredState,
      "running",
    );
    const alphaRecoveredTarget = projects.find(
      (project) => project.slug === "alpha",
    )?.tmuxTarget;
    assert.ok(alphaRecoveredTarget);
    await request(config.socketPath, {
      protocol: protocolVersion,
      type: "project.restart",
      idempotencyKey: "test:restart:alpha",
      payload: { slug: "alpha" },
    });
    projects = await waitForProjects(
      config.socketPath,
      (values) => {
        const alpha = values.find((project) => project.slug === "alpha");
        return (
          alpha?.actualState === "running" &&
          alpha.tmuxTarget !== null &&
          alpha.tmuxTarget !== alphaRecoveredTarget
        );
      },
    );

    await request(config.socketPath, {
      protocol: protocolVersion,
      type: "project.desired.set",
      idempotencyKey: "test:stop:beta",
      payload: { slug: "beta", desiredState: "stopped" },
    });
    projects = await waitForProjects(
      config.socketPath,
      (values) =>
        values.find((project) => project.slug === "beta")?.actualState ===
        "stopped",
    );
    assert.equal(tmux.hasSession("firstmate-beta"), false);
    assert.equal(
      projects.find((project) => project.slug === "beta")?.tmuxSessionName,
      "firstmate-beta",
    );

    await stopDaemon(child, config.socketPath);
    child = spawn(process.execPath, [daemonEntry.pathname], {
      env: environment,
      stdio: "ignore",
    });
    await waitForReady(child, config.socketPath);
    projects = await waitForProjects(
      config.socketPath,
      (values) => {
        const alpha = values.find((project) => project.slug === "alpha");
        const beta = values.find((project) => project.slug === "beta");
        return (
          alpha?.actualState === "running" &&
          beta?.actualState === "stopped"
        );
      },
    );
    assert.equal(projects.length, 2);

    // The whole of what the Fleet's `s` does. A project whose runtime is gone
    // is wanted running again and the supervisor rebuilds the session from
    // durable state alone — no tmux target survived the stop to address it by.
    // Then the tab the stop destroyed is opened again, which is only possible
    // once that session actually exists, so waiting for it is the action.
    tmux.createDetached("pandamate:home", ["/bin/sleep", "300"]);
    assert.equal(controlTabForSession(tmux, "firstmate-beta"), null);
    await request(config.socketPath, {
      protocol: protocolVersion,
      type: "project.desired.set",
      idempotencyKey: "test:start-again:beta",
      payload: { slug: "beta", desiredState: "running" },
    });
    projects = await waitForProjects(config.socketPath, (values) => {
      const beta = values.find((project) => project.slug === "beta");
      return beta?.actualState === "running" && beta.tmuxTarget !== null;
    });
    assert.equal(tmux.hasSession("firstmate-beta"), true);
    assert.equal(
      projects.find((project) => project.slug === "beta")?.desiredState,
      "running",
    );
    await request(config.socketPath, {
      protocol: protocolVersion,
      type: "project.open",
      payload: { slug: "beta" },
    });
    const betaTab = controlTabForSession(tmux, "firstmate-beta");
    assert.equal(betaTab?.name, "beta");

    await stopDaemon(child, config.socketPath);
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
      await new Promise<void>((resolve) => child.once("exit", () => resolve()));
    }
    try {
      tmux.run(["kill-server"]);
    } catch {
      // The isolated server may already have exited with its final session.
    }
    rmSync(directory, { recursive: true, force: true });
  }
});
