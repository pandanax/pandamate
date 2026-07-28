import assert from "node:assert/strict";
import test from "node:test";

import {
  closePandamateSessions,
  planFleetShutdown,
  shutdownFleet,
  TmuxClient,
  type CommandRunner,
  type DiscoveredTmuxSession,
  type FleetShutdownReport,
} from "./index.ts";

/**
 * A tmux server small enough to reason about: it answers the handful of
 * commands a shutdown issues, and forgets a session as soon as it is killed —
 * or as soon as the scripted FirstMate closes it by itself.
 */
class FakeTmuxServer implements CommandRunner {
  readonly commands: Array<readonly string[]> = [];
  readonly sentText: Array<{ readonly pane: string; readonly text: string }> = [];
  #sessions: string[];
  #closeAfterPolls = new Map<string, number>();
  #polls = 0;

  constructor(sessions: readonly string[]) {
    this.#sessions = [...sessions];
  }

  get sessions(): readonly string[] {
    return this.#sessions;
  }

  /**
   * Discovery pass on which this session stops existing, counted from the
   * shutdown's opening survey: pass 1 builds the plan, so pass 2 is the first
   * poll a FirstMate can vanish on.
   */
  closesItselfOnPass(sessionName: string, pass: number): void {
    this.#closeAfterPolls.set(sessionName, pass);
  }

  run(executable: string, args: readonly string[]): string {
    assert.equal(executable, "tmux");
    this.commands.push([...args]);
    const [command] = args;
    const format = args.at(-1) ?? "";
    if (command === "list-sessions") {
      if (format.includes("session_attached")) {
        this.#polls += 1;
        for (const [session, polls] of this.#closeAfterPolls) {
          if (this.#polls >= polls) {
            this.#sessions = this.#sessions.filter((name) => name !== session);
          }
        }
        return this.#sessions
          .map((name, index) => `$${index}|1|1|${name}`)
          .join("\n");
      }
      return this.#sessions
        .map((name, index) => `$${index}|${name}`)
        .join("\n");
    }
    if (command === "list-panes" && args[1] === "-a") {
      return this.#sessions
        .map((_name, index) => `$${index}|0|node|/workspace/${index}`)
        .join("\n");
    }
    if (command === "list-panes") {
      const target = args[2] ?? "";
      const sessionId = target.slice(0, target.indexOf(":"));
      return `${sessionId}:@${sessionId.slice(1)}.%${sessionId.slice(1)}`;
    }
    if (command === "send-keys") {
      if (args.includes("-l")) {
        this.sentText.push({ pane: args[2] ?? "", text: args.at(-1) ?? "" });
      }
      return "";
    }
    if (command === "kill-session") {
      const target = args[2] ?? "";
      const index = Number(target.slice(1));
      const name = this.#sessions[index];
      if (name === undefined) {
        throw new Error(`Unknown tmux session id: ${target}`);
      }
      this.#sessions = this.#sessions.filter((session) => session !== name);
      return "";
    }
    if (command === "display-message") {
      return "@0";
    }
    if (command === "list-windows" && args[1] === "-a") {
      return this.#sessions
        .map((_name, index) => `$${index}|window`)
        .join("\n");
    }
    if (command === "list-windows") {
      return "0|@0|home";
    }
    return "";
  }
}

function killedSessionIds(server: FakeTmuxServer): readonly string[] {
  return server.commands
    .filter((command) => command[0] === "kill-session")
    .map((command) => command[2] ?? "");
}

function discovered(names: readonly string[]): readonly DiscoveredTmuxSession[] {
  return names.map((name, index) => ({
    id: `$${index}`,
    name,
    attachedClients: 0,
    windowCount: 1,
    livePaneCount: 1,
    commands: ["node"],
    paths: [],
    windowNames: [],
  }));
}

test("a shutdown plan claims only the two Pandamate namespaces", () => {
  const plan = planFleetShutdown(
    discovered([
      "firstmate-mandala",
      "pandamate:home",
      "pandamate:idle-probe",
      "work",
      "firstmate-legal",
      "pandamate:service-scheduler",
    ]),
  );

  assert.deepEqual(plan.firstMates, ["firstmate-legal", "firstmate-mandala"]);
  assert.deepEqual(plan.services, [
    "pandamate:idle-probe",
    "pandamate:service-scheduler",
  ]);
  assert.equal(plan.home, "pandamate:home");
  assert.deepEqual(plan.foreign, ["work"]);
});

test("FirstMates that close themselves are never killed, and foreign sessions are left alone", async () => {
  const server = new FakeTmuxServer([
    "firstmate-mandala",
    "firstmate-legal",
    "work",
  ]);
  server.closesItselfOnPass("firstmate-mandala", 2);
  server.closesItselfOnPass("firstmate-legal", 3);
  const tmux = new TmuxClient({ runner: server });
  const progress: FleetShutdownReport[] = [];
  let clock = 0;
  const drained: string[] = [];

  const report = await shutdownFleet({
    tmux,
    daemon: {
      drain: async () => {
        drained.push("drain");
        return "Daemon drained.";
      },
      stop: async () => {
        drained.push("stop");
        return "Daemon stopped.";
      },
    },
    graceMilliseconds: 10_000,
    pollMilliseconds: 100,
    sleep: async (milliseconds) => {
      clock += milliseconds;
    },
    now: () => clock,
    onProgress: (value) => progress.push(value),
  });

  assert.equal(report.phase, "closed");
  assert.deepEqual(
    report.sessions.map((step) => [step.session, step.outcome]),
    [
      ["firstmate-legal", "closed"],
      ["firstmate-mandala", "closed"],
    ],
  );
  assert.deepEqual(report.foreign, ["work"]);
  assert.deepEqual(killedSessionIds(server), []);
  assert.deepEqual(server.sessions, ["work"]);
  // The daemon is drained before any FirstMate is asked to leave, or the
  // supervisor would relaunch the first one that closes its session.
  assert.deepEqual(drained, ["drain", "stop"]);
  assert.equal(server.sentText.length, 2);
  for (const sent of server.sentText) {
    assert.match(sent.text, /graceful shutdown|полное корректное закрытие/i);
  }
  assert.deepEqual(
    progress.map((value) => value.phase)[0],
    "draining",
  );
});

test("a FirstMate that outlasts the grace period is stopped", async () => {
  const server = new FakeTmuxServer(["firstmate-mandala"]);
  const tmux = new TmuxClient({ runner: server });
  const progress: FleetShutdownReport[] = [];
  let clock = 0;

  const report = await shutdownFleet({
    tmux,
    graceMilliseconds: 500,
    pollMilliseconds: 100,
    sleep: async (milliseconds) => {
      clock += milliseconds;
    },
    now: () => clock,
    onProgress: (value) => progress.push(value),
  });

  // Waiting reports on every poll, naming what it waits for and how long is
  // left, so a shutdown that takes minutes never looks like one that hung.
  const waiting = progress.filter((value) =>
    value.headline.startsWith("Waiting for"),
  );
  assert.equal(waiting.length, 5);
  assert.equal(
    waiting[0]?.headline,
    "Waiting for firstmate-mandala · 0s elapsed · 0s before Pandamate stops them",
  );
  assert.match(waiting.at(-1)?.headline ?? "", /firstmate-mandala/);

  assert.deepEqual(
    report.sessions.map((step) => [step.session, step.outcome]),
    [["firstmate-mandala", "forced"]],
  );
  assert.deepEqual(killedSessionIds(server), ["$0"]);
  assert.deepEqual(server.sessions, []);
  assert.match(report.headline, /1 forced/);
});

test("without force, a FirstMate that ignores the request is left running", async () => {
  const server = new FakeTmuxServer(["firstmate-mandala"]);
  const tmux = new TmuxClient({ runner: server });
  let clock = 0;

  const report = await shutdownFleet({
    tmux,
    force: false,
    graceMilliseconds: 200,
    pollMilliseconds: 100,
    sleep: async (milliseconds) => {
      clock += milliseconds;
    },
    now: () => clock,
  });

  assert.deepEqual(
    report.sessions.map((step) => [step.session, step.outcome]),
    [["firstmate-mandala", "left-running"]],
  );
  assert.deepEqual(killedSessionIds(server), []);
});

test("a failed daemon drain aborts before a single FirstMate is disturbed", async () => {
  const server = new FakeTmuxServer(["firstmate-mandala"]);
  const tmux = new TmuxClient({ runner: server });

  const report = await shutdownFleet({
    tmux,
    daemon: {
      drain: async () => {
        throw new Error("socket refused");
      },
      stop: async () => "unreachable",
    },
    sleep: async () => {},
    now: () => 0,
  });

  assert.equal(report.phase, "failed");
  assert.match(report.headline, /socket refused/);
  assert.deepEqual(server.sentText, []);
  assert.deepEqual(server.sessions, ["firstmate-mandala"]);
});

test("Pandamate closes its own windows with home last of all", () => {
  const server = new FakeTmuxServer([
    "pandamate:home",
    "pandamate:idle-probe",
    "firstmate-mandala",
  ]);
  const tmux = new TmuxClient({ runner: server });

  const teardown = closePandamateSessions(tmux);

  assert.deepEqual(teardown.closed, ["pandamate:idle-probe", "pandamate:home"]);
  assert.deepEqual(teardown.failed, []);
  // Sessions are addressed by stable id: idle-probe is $1, home is $0.
  assert.deepEqual(killedSessionIds(server), ["$1", "$0"]);
  assert.deepEqual(server.sessions, ["firstmate-mandala"]);
});

test("keeping home alive leaves the Pandamate window standing", () => {
  const server = new FakeTmuxServer(["pandamate:home", "pandamate:write"]);
  const tmux = new TmuxClient({ runner: server });

  const teardown = closePandamateSessions(tmux, { includeHome: false });

  assert.deepEqual(teardown.closed, ["pandamate:write"]);
  assert.deepEqual(server.sessions, ["pandamate:home"]);
});
