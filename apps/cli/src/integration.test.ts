import assert from "node:assert/strict";
import { execFile as execFileCallback, spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import { TmuxClient } from "@pandamate/runtime-tmux";

const execFile = promisify(execFileCallback);

async function waitForCli(
  cliEntry: string,
  environment: NodeJS.ProcessEnv,
): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      await execFile(process.execPath, [cliEntry, "daemon", "status"], {
        env: environment,
      });
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  throw new Error("Daemon did not become ready for CLI");
}

async function waitForExit(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  await new Promise<void>((resolve) => child.once("exit", () => resolve()));
}

test("CLI shows identical projects and event journal after daemon restart", async () => {
  const directory = mkdtempSync(join(tmpdir(), "pandamate-cli-"));
  const tmuxSocketName = `pandamate-cli-test-${process.pid}`;
  const tmux = new TmuxClient({ socketName: tmuxSocketName });
  const onboardingWorkspace = join(directory, "new-site");
  mkdirSync(onboardingWorkspace);
  const fakeEntry = new URL(
    "../../../fixtures/fake-firstmate/src/main.ts",
    import.meta.url,
  ).pathname;
  const environment = {
    ...process.env,
    PANDAMATE_STATE_DIR: `${directory}/state`,
    PANDAMATE_RUNTIME_DIR: `${directory}/runtime`,
    PANDAMATE_TMUX_SOCKET_NAME: tmuxSocketName,
    PANDAMATE_FIRSTMATE_ADAPTER: "fake",
    PANDAMATE_FAKE_FIRSTMATE_ENTRY: fakeEntry,
    PANDAMATE_RECONCILE_INTERVAL_MS: "100",
  };
  const cliEntry = new URL("./main.ts", import.meta.url).pathname;
  const daemonEntry = new URL("../../daemon/src/main.ts", import.meta.url)
    .pathname;
  const launch = () =>
    spawn(process.execPath, [daemonEntry], {
      env: environment,
      stdio: "ignore",
    });
  const run = async (...args: readonly string[]) =>
    (
      await execFile(process.execPath, [cliEntry, ...args], {
        env: environment,
      })
    ).stdout;
  tmux.createDetached("existing-mandala", ["sleep", "60"]);
  let daemon = launch();

  try {
    await waitForCli(cliEntry, environment);
    await run(
      "project",
      "add",
      "mandala",
      "Mandala",
      "git",
      "/workspace/mandala",
    );
    await run(
      "project",
      "add",
      "arc-1234",
      "ARC-1234",
      "arc",
      "/workspace/arcadia",
    );
    await run(
      "project",
      "add",
      "legal",
      "Legal",
      "docs",
      "/workspace/legal",
    );
    const created = JSON.parse(
      await run(
        "project",
        "create",
        "FirstMateGit",
        onboardingWorkspace,
        "--json",
      ),
    ) as {
      readonly profile: string;
      readonly project: {
        readonly slug: string;
        readonly desiredState: string;
      };
    };
    assert.equal(created.profile, "FirstMateGit");
    assert.equal(created.project.slug, "new-site");
    assert.equal(created.project.desiredState, "running");
    await run("stop", "new-site");
    let onboardingStopped = false;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const status = JSON.parse(
        await run("status", "--json"),
      ) as {
        readonly projects: ReadonlyArray<{
          readonly slug: string;
          readonly actualState: string;
        }>;
      };
      if (
        status.projects.find((project) => project.slug === "new-site")
          ?.actualState === "stopped"
      ) {
        onboardingStopped = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(onboardingStopped, true);
    const adoption = JSON.parse(
      await run(
        "project",
        "adopt",
        "mandala",
        "existing-mandala",
        "--json",
      ),
    ) as {
      readonly tmuxTarget: string | null;
      readonly desiredState: string;
      readonly actualState: string;
    };
    assert.match(adoption.tmuxTarget ?? "", /^\$\d+$/);
    assert.equal(adoption.desiredState, "running");
    assert.equal(adoption.actualState, "running");
    await run("start", "mandala");
    const beforeStatus = JSON.parse(
      await run("status", "--json"),
    ) as unknown;
    const beforeEvents = JSON.parse(
      await run("events", "--json"),
    ) as unknown;

    await run("daemon", "stop");
    await waitForExit(daemon);
    daemon = launch();
    await waitForCli(cliEntry, environment);

    assert.deepEqual(
      JSON.parse(await run("status", "--json")),
      beforeStatus,
    );
    assert.deepEqual(
      JSON.parse(await run("events", "--json")),
      beforeEvents,
    );
    await run("daemon", "stop");
    await waitForExit(daemon);
  } finally {
    if (daemon.exitCode === null && daemon.signalCode === null) {
      daemon.kill("SIGTERM");
      await waitForExit(daemon);
    }
    try {
      for (const session of tmux.listSessions()) {
        tmux.killSession(session);
      }
    } catch {
      // The private tmux server exits automatically after its last session.
    }
    rmSync(directory, { recursive: true, force: true });
  }
});

test("shutdown-all closes a FirstMate gracefully, stops the daemon, and stays closed", async () => {
  const directory = mkdtempSync(join(tmpdir(), "pandamate-shutdown-"));
  const tmuxSocketName = `pandamate-shutdown-test-${process.pid}`;
  const tmux = new TmuxClient({ socketName: tmuxSocketName });
  const fakeEntry = new URL(
    "../../../fixtures/fake-firstmate/src/main.ts",
    import.meta.url,
  ).pathname;
  const environment = {
    ...process.env,
    PANDAMATE_STATE_DIR: `${directory}/state`,
    PANDAMATE_RUNTIME_DIR: `${directory}/runtime`,
    PANDAMATE_TMUX_SOCKET_NAME: tmuxSocketName,
    PANDAMATE_FIRSTMATE_ADAPTER: "fake",
    PANDAMATE_FAKE_FIRSTMATE_ENTRY: fakeEntry,
    PANDAMATE_RECONCILE_INTERVAL_MS: "100",
  };
  const cliEntry = new URL("./main.ts", import.meta.url).pathname;
  const daemonEntry = new URL("../../daemon/src/main.ts", import.meta.url)
    .pathname;
  const launch = () =>
    spawn(process.execPath, [daemonEntry], {
      env: environment,
      stdio: "ignore",
    });
  const run = async (...args: readonly string[]) =>
    (
      await execFile(process.execPath, [cliEntry, ...args], {
        env: environment,
      })
    ).stdout;

  // A stand-in FirstMate that does what the graceful prompt asks: it reads the
  // instruction and closes its own session as its last act. And a session
  // outside both Pandamate namespaces, which must survive untouched.
  // `read -n 1` puts the tty in raw mode: the graceful prompt is longer than
  // the terminal's canonical line buffer, so a plain `read` would never see a
  // complete line to act on.
  tmux.createDetached("firstmate-phantom", ["bash -c 'read -n 1; exit 0'"]);
  tmux.createDetached("work", ["sleep", "120"]);
  let daemon = launch();

  try {
    await waitForCli(cliEntry, environment);
    await run("project", "add", "ghost", "Ghost", "git", directory);
    await run("project", "adopt", "ghost", "firstmate-phantom");

    const report = JSON.parse(
      await run("shutdown-all", "--timeout", "20", "--json"),
    ) as {
      readonly phase: string;
      readonly sessions: ReadonlyArray<{
        readonly session: string;
        readonly outcome: string;
      }>;
      readonly foreign: readonly string[];
    };

    assert.equal(report.phase, "closed");
    assert.deepEqual(report.sessions, [
      { session: "firstmate-phantom", outcome: "closed", detail: "Closed itself gracefully" },
    ]);
    assert.deepEqual(report.foreign, ["work"]);
    assert.deepEqual(tmux.listSessions(), ["work"]);
    await waitForExit(daemon);

    // Nothing comes back by itself: the drain marked the project stopped, so a
    // fresh daemon leaves it closed instead of recovering a missing runtime.
    daemon = launch();
    await waitForCli(cliEntry, environment);
    const status = JSON.parse(await run("status", "--json")) as {
      readonly projects: ReadonlyArray<{
        readonly slug: string;
        readonly desiredState: string;
        readonly actualState: string;
      }>;
    };
    const ghost = status.projects.find((project) => project.slug === "ghost");
    assert.equal(ghost?.desiredState, "stopped");
    assert.equal(ghost?.actualState, "stopped");
    assert.deepEqual(tmux.listSessions(), ["work"]);
    await run("daemon", "stop");
    await waitForExit(daemon);
  } finally {
    if (daemon.exitCode === null && daemon.signalCode === null) {
      daemon.kill("SIGTERM");
      await waitForExit(daemon);
    }
    try {
      for (const session of tmux.listSessions()) {
        tmux.killSession(session);
      }
    } catch {
      // The private tmux server exits automatically after its last session.
    }
    rmSync(directory, { recursive: true, force: true });
  }
});
