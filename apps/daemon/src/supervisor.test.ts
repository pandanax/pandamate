import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { loadConfig, type PandamateConfig } from "@pandamate/config";
import type { ActualState, Project } from "@pandamate/domain";

import { FirstMateSupervisor, firstMateProfileForProject } from "./supervisor.ts";

test("maps durable project kinds to public FirstMate profiles", () => {
  assert.equal(
    firstMateProfileForProject({ kind: "arc" }).name,
    "FirstMateArc",
  );
  assert.equal(
    firstMateProfileForProject({ kind: "git" }).name,
    "FirstMateGit",
  );
  assert.equal(
    firstMateProfileForProject({ kind: "docs" }).name,
    "DocResearch",
  );
});

test("only the code profiles supervise workers", () => {
  assert.equal(firstMateProfileForProject({ kind: "arc" }).supervises, true);
  assert.equal(firstMateProfileForProject({ kind: "git" }).supervises, true);
  assert.equal(firstMateProfileForProject({ kind: "docs" }).supervises, false);
});

/**
 * Reach the launch prompt for a project kind under the real (claude-code)
 * adapter without standing up a reconciliation pass; the prompt is the final
 * argv element.
 */
function launchPromptForKind(
  kind: Project["kind"],
  mergeMode: Project["mergeMode"] = "manual",
): string {
  const directory = mkdtempSync(join(tmpdir(), "pandamate-prompt-"));
  try {
    const supervisor = new FirstMateSupervisor({
      config: fixtureConfig(directory),
      store: new FakeStore([]),
      tmux: new FakeTmux(),
    });
    const project = {
      ...fixtureProject(join(directory, "workspace")),
      kind,
      mergeMode,
    };
    const command = supervisor.launchCommand(project);
    return command[command.length - 1] ?? "";
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("DocResearch launches as a light research partner, not a FirstMate", () => {
  const prompt = launchPromptForKind("docs");
  assert.match(prompt, /research partner \(DocResearch\)/);
  assert.match(prompt, /clarifying questions/);
  // The heavy supervisor framing must not reach a research workspace.
  assert.doesNotMatch(prompt, /the main FirstMate/);
  assert.doesNotMatch(prompt, /Supervise any workers/);
  // No crew/worktree/PR protocol: the runtime line drops the FirstMate role
  // framing and the product is documents, not pull requests.
  assert.doesNotMatch(
    prompt,
    /FirstMate is this long-running main Claude Code process and role/,
  );
  assert.match(prompt, /no crew, worktree, or pull-request machinery/);
  assert.match(prompt, /not pull requests/);
  // The code-isolation rule is for code-shipping FirstMates, not research.
  assert.doesNotMatch(prompt, /merge mode is/);
  // Lifecycle framing is unchanged: identity header and the safety line stay.
  assert.match(prompt, /FIRSTMATE_OP: v1/);
  assert.match(prompt, /long-running main Claude Code process/);
  assert.match(
    prompt,
    /Never operate on unrelated projects or pandamate:\* control-plane sessions\./,
  );
});

test("Arc and Git keep the full FirstMate supervisor framing", () => {
  for (const kind of ["arc", "git"] as const) {
    const prompt = launchPromptForKind(kind);
    assert.match(prompt, /the main FirstMate/);
    assert.match(prompt, /Supervise any workers you create/);
    // Code work is isolated on its own branch; landing is VCS-specific.
    assert.match(prompt, /its own isolated worktree/);
    if (kind === "git") {
      assert.match(prompt, /merge mode is manual/);
      assert.match(prompt, /wait for the captain to merge/);
    } else {
      assert.match(prompt, /For arc, open a PR and watch CI/);
    }
    assert.match(
      prompt,
      /FirstMate is this long-running main Claude Code process and role/,
    );
    assert.match(
      prompt,
      /Never operate on unrelated projects or pandamate:\* control-plane sessions\./,
    );
    assert.doesNotMatch(prompt, /research partner/);
  }
});

test("Git merge authority comes from the project", () => {
  const automatic = launchPromptForKind("git", "auto");
  assert.match(automatic, /merge mode is auto/);
  assert.match(automatic, /enable the forge's native auto-merge/);
  assert.match(automatic, /Do not push the protected default branch/);
  assert.match(automatic, /Do not ask the captain to merge/);

  const manual = launchPromptForKind("git", "manual");
  assert.match(manual, /merge mode is manual/);
  assert.match(manual, /wait for the captain to merge/);
  assert.doesNotMatch(manual, /enable the forge's native auto-merge/);
});

interface FakeWindow {
  readonly id: string;
  index: number;
  name: string;
}

interface FakeSession {
  readonly id: string;
  name: string;
  readonly windows: FakeWindow[];
}

/**
 * Enough tmux to drive one reconciliation pass: sessions, their windows, and
 * the two list formats the supervisor reads. Unknown commands throw so a new
 * tmux call cannot pass a test unnoticed.
 */
class FakeTmux {
  readonly sessions: FakeSession[] = [];
  readonly commands: string[][] = [];
  readonly environment: Array<{
    readonly session: string;
    readonly name: string;
    readonly value: string;
  }> = [];
  readonly launches: Array<{
    readonly session: string;
    readonly workspace: string;
    readonly command: readonly string[];
  }> = [];
  #nextSession = 1;
  #nextWindow = 1;

  run(args: readonly string[]): string {
    this.commands.push([...args]);
    switch (args[0]) {
      case "list-sessions":
        return this.sessions
          .map(
            (session) =>
              `${session.id}|0|${session.windows.length}|${session.name}`,
          )
          .join("\n");
      case "list-panes":
        return this.sessions
          .flatMap((session) =>
            session.windows.map(() => `${session.id}|0|node|/workspace`),
          )
          .join("\n");
      case "list-windows":
        if (args[1] === "-a") {
          return this.sessions
            .flatMap((session) =>
              session.windows.map(
                (window) => `${session.id}|${window.name}`,
              ),
            )
            .join("\n");
        }
        return this.#byId(args[2] ?? "")
          .windows.map((window) => `${window.index}|${window.id}|${window.name}`)
          .join("\n");
      case "new-window": {
        const session = this.#byId(args[3] ?? "");
        const window = {
          id: `@${this.#nextWindow++}`,
          index: session.windows.length,
          name: args[5] ?? "",
        };
        session.windows.push(window);
        return window.id;
      }
      case "set-environment":
        this.environment.push({
          session: args[2] ?? "",
          name: args[3] ?? "",
          value: args[4] ?? "",
        });
        return "";
      default:
        throw new Error(`Unexpected tmux command: ${args.join(" ")}`);
    }
  }

  resolveSession(sessionName: string): string {
    const session = this.sessions.find((item) => item.name === sessionName);
    if (!session) {
      throw new Error(`Unknown tmux session: ${sessionName}`);
    }
    return session.id;
  }

  createDetachedInDirectory(
    target: string,
    workspace: string,
    command: readonly string[],
  ): void {
    this.launches.push({ session: target, workspace, command: [...command] });
    this.sessions.push({
      id: `$${this.#nextSession++}`,
      name: target,
      windows: [{ id: `@${this.#nextWindow++}`, index: 0, name: target }],
    });
  }

  killSession(target: string): void {
    const index = this.sessions.findIndex((item) => item.name === target);
    if (index >= 0) {
      this.sessions.splice(index, 1);
    }
  }

  renameSession(target: string, newName: string): void {
    this.#byName(target).name = newName;
  }

  setSessionEnvironment(sessionName: string, name: string, value: string): void {
    this.environment.push({
      session: this.resolveSession(sessionName),
      name,
      value,
    });
  }

  windowNames(sessionName: string): readonly string[] {
    return this.#byName(sessionName).windows.map((window) => window.name);
  }

  closeWindow(sessionName: string, windowName: string): void {
    const session = this.#byName(sessionName);
    const index = session.windows.findIndex(
      (window) => window.name === windowName,
    );
    session.windows.splice(index, 1);
  }

  #byId(sessionId: string): FakeSession {
    const session = this.sessions.find((item) => item.id === sessionId);
    if (!session) {
      throw new Error(`Unknown tmux session id: ${sessionId}`);
    }
    return session;
  }

  #byName(sessionName: string): FakeSession {
    return this.#byId(this.resolveSession(sessionName));
  }
}

class FakeStore {
  #projects: Project[];

  constructor(projects: readonly Project[]) {
    this.#projects = [...projects];
  }

  listProjects(): readonly Project[] {
    return this.#projects;
  }

  recordProjectRuntime(
    slug: string,
    observation: {
      readonly actualState: ActualState;
      readonly tmuxTarget: string | null;
      readonly tmuxSessionName: string | null;
      readonly currentSummary: string;
      readonly lastHeartbeatAt: string | null;
    },
  ): Project {
    const index = this.#projects.findIndex((item) => item.slug === slug);
    const updated = { ...this.#projects[index], ...observation } as Project;
    this.#projects[index] = updated;
    return updated;
  }
}

function fixtureProject(workspace: string): Project {
  return {
    id: "prj_fixture",
    slug: "fixture",
    title: "Fixture",
    customDisplayName: null,
    kind: "arc",
    mergeMode: "manual",
    workspace,
    desiredState: "running",
    actualState: "starting",
    tmuxTarget: null,
    tmuxSessionName: null,
    currentSummary: "Registered",
    attentionLevel: "none",
    lastHeartbeatAt: null,
    version: 1,
    createdAt: "2026-07-27T12:00:00.000Z",
    updatedAt: "2026-07-27T12:00:00.000Z",
  };
}

function fixtureConfig(directory: string): PandamateConfig {
  return loadConfig({
    PANDAMATE_STATE_DIR: join(directory, "state"),
    PANDAMATE_RUNTIME_DIR: join(directory, "runtime"),
    PANDAMATE_CLAUDE_EXECUTABLE: join(directory, "claude"),
  });
}

function watcherWorkspace(directory: string): string {
  const workspace = join(directory, "workspace");
  mkdirSync(join(workspace, ".pandamate"), { recursive: true });
  const watcher = join(workspace, ".pandamate", "watch");
  writeFileSync(watcher, "#!/bin/sh\nsleep 300\n");
  chmodSync(watcher, 0o755);
  return workspace;
}

/**
 * A separate firstmate home holding the crew tooling's own `bin/fm-watch`, the
 * way an arc FirstMate keeps it entirely outside its product-code workspace.
 */
function firstMateHomeWithWatcher(directory: string): string {
  const home = join(directory, "firstmate-home");
  mkdirSync(join(home, "bin"), { recursive: true });
  const watcher = join(home, "bin", "fm-watch");
  writeFileSync(watcher, "#!/bin/sh\nsleep 300\n");
  chmodSync(watcher, 0o755);
  return home;
}

test("deploys the Watcher beside a launched FirstMate and puts it back when it dies", () => {
  const directory = mkdtempSync(join(tmpdir(), "pandamate-watcher-"));
  try {
    const workspace = watcherWorkspace(directory);
    const tmux = new FakeTmux();
    tmux.createDetachedInDirectory("pandamate:home", directory, ["/bin/sh"]);
    const store = new FakeStore([fixtureProject(workspace)]);
    let now = Date.parse("2026-07-27T12:00:00.000Z");
    const config = fixtureConfig(directory);
    const supervisor = new FirstMateSupervisor({
      config,
      store,
      tmux,
      now: () => new Date(now),
    });

    supervisor.reconcileNow();
    assert.deepEqual(tmux.windowNames("firstmate-fixture"), [
      "firstmate-fixture",
      "watch",
    ]);
    const launch = tmux.launches.find(
      (entry) => entry.session === "firstmate-fixture",
    );
    assert.ok(
      launch?.command.includes("PANDAMATE_TMUX_SESSION=firstmate-fixture"),
    );
    // Window 0 learns its session from the launch argv, the Watcher window from
    // the session environment.
    assert.ok(tmux.environment.length > 0);
    assert.ok(
      tmux.environment.every(
        (entry) =>
          entry.name === "PANDAMATE_TMUX_SESSION" &&
          entry.value === "firstmate-fixture",
      ),
    );

    // A healthy Watcher is left alone, however often reconciliation runs.
    now += 60_000;
    supervisor.reconcileNow();
    supervisor.reconcileNow();
    assert.deepEqual(tmux.windowNames("firstmate-fixture"), [
      "firstmate-fixture",
      "watch",
    ]);

    tmux.closeWindow("firstmate-fixture", "watch");
    now += 60_000;
    supervisor.reconcileNow();
    assert.deepEqual(tmux.windowNames("firstmate-fixture"), [
      "firstmate-fixture",
      "watch",
    ]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("deploys an arc FirstMate's Watcher from its firstmate home when the workspace is product code", () => {
  const directory = mkdtempSync(join(tmpdir(), "pandamate-arc-watcher-"));
  try {
    // Product code with no watcher of its own, like monomarket.
    const workspace = join(directory, "product");
    mkdirSync(workspace, { recursive: true });
    const home = firstMateHomeWithWatcher(directory);
    const tmux = new FakeTmux();
    tmux.createDetachedInDirectory("pandamate:home", directory, ["/bin/sh"]);
    const store = new FakeStore([
      { ...fixtureProject(workspace), kind: "arc" as const },
    ]);
    const config = loadConfig({
      PANDAMATE_STATE_DIR: join(directory, "state"),
      PANDAMATE_RUNTIME_DIR: join(directory, "runtime"),
      PANDAMATE_CLAUDE_EXECUTABLE: join(directory, "claude"),
      PANDAMATE_FIRSTMATE_HOME: home,
    });
    const supervisor = new FirstMateSupervisor({ config, store, tmux });

    supervisor.reconcileNow();
    assert.deepEqual(tmux.windowNames("firstmate-fixture"), [
      "firstmate-fixture",
      "watch",
    ]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("does not lend the arc firstmate home to a git project without its own Watcher", () => {
  const directory = mkdtempSync(join(tmpdir(), "pandamate-git-no-watcher-"));
  try {
    const workspace = join(directory, "repo");
    mkdirSync(workspace, { recursive: true });
    const home = firstMateHomeWithWatcher(directory);
    const tmux = new FakeTmux();
    tmux.createDetachedInDirectory("pandamate:home", directory, ["/bin/sh"]);
    const store = new FakeStore([
      { ...fixtureProject(workspace), kind: "git" as const },
    ]);
    const config = loadConfig({
      PANDAMATE_STATE_DIR: join(directory, "state"),
      PANDAMATE_RUNTIME_DIR: join(directory, "runtime"),
      PANDAMATE_CLAUDE_EXECUTABLE: join(directory, "claude"),
      PANDAMATE_FIRSTMATE_HOME: home,
    });
    const supervisor = new FirstMateSupervisor({ config, store, tmux });

    supervisor.reconcileNow();
    // A git project resolves its watcher only from its own workspace, so the
    // arc home never leaks into it.
    assert.deepEqual(tmux.windowNames("firstmate-fixture"), [
      "firstmate-fixture",
    ]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("derives an arc FirstMate's firstmate home from the workspace's arc root, no config", () => {
  const directory = mkdtempSync(join(tmpdir(), "pandamate-arc-derive-"));
  try {
    // Mark the arc mount root and put the shared crew tooling where an arc
    // checkout keeps it: junk/pandanax/firstmate/bin/fm-watch.
    mkdirSync(join(directory, ".arc"), { recursive: true });
    const crewBin = join(directory, "junk", "pandanax", "firstmate", "bin");
    mkdirSync(crewBin, { recursive: true });
    const watcher = join(crewBin, "fm-watch");
    writeFileSync(watcher, "#!/bin/sh\nsleep 300\n");
    chmodSync(watcher, 0o755);
    // Product-code workspace deep under that root, like monomarket.
    const workspace = join(directory, "market", "front", "monomarket");
    mkdirSync(workspace, { recursive: true });

    const tmux = new FakeTmux();
    tmux.createDetachedInDirectory("pandamate:home", directory, ["/bin/sh"]);
    const store = new FakeStore([
      { ...fixtureProject(workspace), kind: "arc" as const },
    ]);
    // No PANDAMATE_FIRSTMATE_HOME — the home is known from the arc root alone.
    const config = fixtureConfig(directory);
    const supervisor = new FirstMateSupervisor({ config, store, tmux });

    supervisor.reconcileNow();
    assert.deepEqual(tmux.windowNames("firstmate-fixture"), [
      "firstmate-fixture",
      "watch",
    ]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("stops redeploying a Watcher that never survives its backoff", () => {
  const directory = mkdtempSync(join(tmpdir(), "pandamate-watcher-"));
  try {
    const workspace = watcherWorkspace(directory);
    const tmux = new FakeTmux();
    tmux.createDetachedInDirectory("pandamate:home", directory, ["/bin/sh"]);
    const store = new FakeStore([fixtureProject(workspace)]);
    let now = Date.parse("2026-07-27T12:00:00.000Z");
    const events: string[] = [];
    const config = fixtureConfig(directory);
    const supervisor = new FirstMateSupervisor({
      config,
      store,
      tmux,
      log: (_level, event) => events.push(event),
      now: () => new Date(now),
    });

    supervisor.reconcileNow();
    for (let attempt = 0; attempt < 10; attempt += 1) {
      tmux.closeWindow("firstmate-fixture", "watch");
      // A Watcher that dies inside the backoff is not redeployed immediately…
      supervisor.reconcileNow();
      assert.deepEqual(tmux.windowNames("firstmate-fixture"), [
        "firstmate-fixture",
      ]);
      now += config.watcherRestartBackoffMs;
      supervisor.reconcileNow();
      if (tmux.windowNames("firstmate-fixture").length === 1) {
        break;
      }
    }

    // …and after five futile deploys the supervisor stops and says so.
    assert.equal(
      events.filter((event) => event === "supervisor.watcher.deployed").length,
      5,
    );
    assert.ok(events.includes("supervisor.watcher.abandoned"));
    assert.deepEqual(tmux.windowNames("firstmate-fixture"), [
      "firstmate-fixture",
    ]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("leaves a project without a declared Watcher and an adopted session alone", () => {
  const directory = mkdtempSync(join(tmpdir(), "pandamate-watcher-"));
  try {
    const bare = join(directory, "bare");
    mkdirSync(bare);
    const tmux = new FakeTmux();
    tmux.createDetachedInDirectory("pandamate:home", directory, ["/bin/sh"]);
    const store = new FakeStore([fixtureProject(bare)]);
    const supervisor = new FirstMateSupervisor({
      config: fixtureConfig(directory),
      store,
      tmux,
    });

    supervisor.reconcileNow();
    supervisor.reconcileNow();
    assert.deepEqual(tmux.windowNames("firstmate-fixture"), [
      "firstmate-fixture",
    ]);

    // An adopted session was built by somebody else; Pandamate does not
    // furnish it with windows even when the workspace declares a Watcher.
    const adoptedTmux = new FakeTmux();
    adoptedTmux.createDetachedInDirectory("handmade", directory, ["/bin/sh"]);
    const adopted = {
      ...fixtureProject(watcherWorkspace(directory)),
      actualState: "running" as const,
      tmuxSessionName: "handmade",
    };
    new FirstMateSupervisor({
      config: fixtureConfig(directory),
      store: new FakeStore([adopted]),
      tmux: adoptedTmux,
    }).reconcileNow();
    assert.deepEqual(adoptedTmux.windowNames("handmade"), ["handmade"]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a draining supervisor never relaunches a FirstMate that closed itself", () => {
  const directory = mkdtempSync(join(tmpdir(), "pandamate-drain-"));
  try {
    const workspace = join(directory, "bare");
    mkdirSync(workspace);
    const tmux = new FakeTmux();
    tmux.createDetachedInDirectory("pandamate:home", directory, ["/bin/sh"]);
    const store = new FakeStore([fixtureProject(workspace)]);
    const supervisor = new FirstMateSupervisor({
      config: fixtureConfig(directory),
      store,
      tmux,
    });

    supervisor.reconcileNow();
    assert.equal(tmux.launches.length, 2);

    // The last step of a graceful shutdown is the FirstMate closing its own
    // session. Ordinary supervision would read that as a crash.
    supervisor.setDraining(true);
    assert.equal(supervisor.draining, true);
    tmux.killSession("firstmate-fixture");
    supervisor.reconcileNow();
    supervisor.reconcileNow();

    assert.equal(tmux.launches.length, 2);
    assert.deepEqual(
      tmux.sessions.map((session) => session.name),
      ["pandamate:home"],
    );
    assert.equal(store.listProjects()[0]?.actualState, "stopped");
    assert.equal(
      store.listProjects()[0]?.currentSummary,
      "Closed during a full Pandamate shutdown",
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("draining also suspends the kill a stopped project would normally get", () => {
  const directory = mkdtempSync(join(tmpdir(), "pandamate-drain-"));
  try {
    const workspace = join(directory, "bare");
    mkdirSync(workspace);
    const tmux = new FakeTmux();
    tmux.createDetachedInDirectory("pandamate:home", directory, ["/bin/sh"]);
    tmux.createDetachedInDirectory("firstmate-fixture", workspace, ["/bin/sh"]);
    const store = new FakeStore([
      {
        ...fixtureProject(workspace),
        desiredState: "stopped" as const,
        actualState: "running" as const,
        tmuxSessionName: "firstmate-fixture",
      },
    ]);
    const supervisor = new FirstMateSupervisor({
      config: fixtureConfig(directory),
      store,
      tmux,
    });

    // Mid-shutdown the FirstMate is still unmounting and dismissing its crew,
    // so a desired stop must not turn into an immediate kill.
    supervisor.setDraining(true);
    supervisor.reconcileNow();
    assert.deepEqual(
      tmux.sessions.map((session) => session.name),
      ["pandamate:home", "firstmate-fixture"],
    );

    // A daemon restart, or an explicit resume, brings ordinary supervision back.
    supervisor.setDraining(false);
    supervisor.reconcileNow();
    assert.deepEqual(
      tmux.sessions.map((session) => session.name),
      ["pandamate:home"],
    );
    assert.equal(store.listProjects()[0]?.actualState, "stopped");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
