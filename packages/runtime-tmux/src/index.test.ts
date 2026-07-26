import assert from "node:assert/strict";
import test from "node:test";

import {
  attachCommandForSessionId,
  discoverTmuxSessions,
  closeControlTab,
  isPandamateControlSession,
  openSessionAsControlTab,
  openSessionInNewITermWindow,
  requestFirstMateReset,
  requestGracefulSessionShutdown,
  targetForPandamateService,
  targetForProject,
  TmuxClient,
  validateClientTty,
  validateProjectSlug,
  validateSocketName,
  validateStablePaneId,
  validateStableSessionId,
  type CommandRunner,
} from "./index.ts";

class RecordingRunner implements CommandRunner {
  readonly calls: Array<{
    executable: string;
    args: readonly string[];
  }> = [];
  readonly #responses: string[];

  constructor(responses: readonly string[] = []) {
    this.#responses = [...responses];
  }

  run(executable: string, args: readonly string[]): string {
    this.calls.push({ executable, args: [...args] });
    return this.#responses.shift() ?? "";
  }
}

test("creates stable namespaced targets", () => {
  assert.equal(targetForProject("mandala"), "firstmate-mandala");
});

test("classifies Pandamate services separately from project sessions", () => {
  assert.equal(
    targetForPandamateService("idle-probe"),
    "pandamate:idle-probe",
  );
  assert.equal(
    targetForPandamateService("service-scheduler"),
    "pandamate:service-scheduler",
  );
  assert.throws(() => targetForPandamateService("mandala"));
  for (const name of [
    "pandamate:home",
    "pandamate:write",
    "pandamate:idle-probe",
    "pandamate:probe-keeper",
    "pandamate:control-debug",
    "pandamate:service-scheduler",
  ]) {
    assert.equal(isPandamateControlSession(name), true);
  }
  assert.equal(isPandamateControlSession("pandamate:mandala"), false);
  assert.equal(isPandamateControlSession("firstmate"), false);
});

test("rejects unsafe project slugs and tmux socket names", () => {
  for (const value of [
    "",
    "../x",
    "UPPER",
    "x;run-shell id",
    "x y",
    "x-",
    "write",
    "service-scheduler",
  ]) {
    assert.throws(() => validateProjectSlug(value));
  }
  assert.equal(validateSocketName("pandamate-test_42"), "pandamate-test_42");
  assert.throws(() => validateSocketName("../default"));
});

test("validates stable targets and concrete client tty paths", () => {
  assert.equal(validateStablePaneId("$1:@4.%9"), "$1:@4.%9");
  assert.throws(() => validateStablePaneId("pandamate:home.2.1"));
  assert.equal(validateStableSessionId("$12"), "$12");
  assert.throws(() => validateStableSessionId("pandamate:home"));
  assert.equal(validateClientTty("/dev/ttys004"), "/dev/ttys004");
  assert.equal(validateClientTty("/dev/pts/3"), "/dev/pts/3");
  assert.throws(() => validateClientTty("-a"));
});

test("executes tmux with an argument array and preserves argument boundaries", () => {
  const runner = new RecordingRunner();
  const tmux = new TmuxClient({
    socketName: "isolated-42",
    runner,
  });

  tmux.createDetached("pandamate:mandala", [
    "/usr/bin/node",
    "/workspace with spaces/fixture.ts",
  ]);

  assert.deepEqual(runner.calls, [
    {
      executable: "tmux",
      args: [
        "-L",
        "isolated-42",
        "new-session",
        "-d",
        "-s",
        "pandamate:mandala",
        "/usr/bin/node",
        "/workspace with spaces/fixture.ts",
      ],
    },
  ]);
});

test("creates a detached session in a canonical workspace", () => {
  const runner = new RecordingRunner();
  const tmux = new TmuxClient({ runner });
  tmux.createDetachedInDirectory(
    "pandamate:mandala",
    "/workspace with spaces/mandala",
    ["/usr/bin/node", "/fixture/main.ts"],
  );
  assert.deepEqual(runner.calls[0], {
    executable: "tmux",
    args: [
      "new-session",
      "-d",
      "-s",
      "pandamate:mandala",
      "-c",
      "/workspace with spaces/mandala",
      "/usr/bin/node",
      "/fixture/main.ts",
    ],
  });
  assert.throws(() =>
    tmux.createDetachedInDirectory("pandamate:x", "/tmp/../tmp", ["node"]),
  );
});

test("renames a session through its stable id", () => {
  const runner = new RecordingRunner([
    "$6\tpandamate:mandala",
    "",
  ]);
  const tmux = new TmuxClient({ runner });
  tmux.renameSession("pandamate:mandala", "firstmate-mandala");
  assert.deepEqual(runner.calls, [
    {
      executable: "tmux",
      args: ["list-sessions", "-F", "#{session_id}\t#{session_name}"],
    },
    {
      executable: "tmux",
      args: ["rename-session", "-t", "$6", "firstmate-mandala"],
    },
  ]);
});

test("discovers and aggregates sessions from bounded tmux formats", () => {
  const runner = new RecordingRunner([
    "$2\tzeta\t0\t2\n$1\talpha\t1\t1",
    "$2\t0\tzsh\t/workspace/zeta\n$2\t1\tnode\t/workspace/zeta\n$1\t0\tnode\t/workspace/alpha",
  ]);
  const tmux = new TmuxClient({ runner });

  assert.deepEqual(discoverTmuxSessions(tmux), [
    {
      id: "$1",
      name: "alpha",
      attachedClients: 1,
      windowCount: 1,
      livePaneCount: 1,
      commands: ["node"],
      paths: ["/workspace/alpha"],
    },
    {
      id: "$2",
      name: "zeta",
      attachedClients: 0,
      windowCount: 2,
      livePaneCount: 1,
      commands: ["node", "zsh"],
      paths: ["/workspace/zeta"],
    },
  ]);
});

test("rejects malformed discovery evidence", () => {
  const unknownPane = new RecordingRunner([
    "$1\talpha\t0\t1",
    "$2\t0\tnode\t/workspace",
  ]);
  assert.throws(
    () => discoverTmuxSessions(new TmuxClient({ runner: unknownPane })),
    /unknown tmux session/,
  );
});

test("opens iTerm with an argument array and a stable resolved session id", () => {
  const runner = new RecordingRunner(["/opt/homebrew/bin/tmux"]);
  const sessionId = openSessionInNewITermWindow(
    { resolveSession: () => "$12" },
    "mandala",
    runner,
  );
  assert.equal(sessionId, "$12");
  assert.deepEqual(runner.calls[0], {
    executable: "/usr/bin/which",
    args: ["tmux"],
  });
  assert.equal(runner.calls[1]?.executable, "osascript");
  assert.deepEqual(
    runner.calls[1]?.args.slice(0, 2),
    ["-e", 'tell application "iTerm"'],
  );
  const scriptLine =
    runner.calls[1]?.args.find((argument) =>
      argument.includes("tmux attach-session"),
    ) ?? "";
  assert.match(
    scriptLine,
    /\/opt\/homebrew\/bin\/tmux attach-session -t '\$12'/,
  );
});

function tabTmux(
  windowId: string,
  controlWindows: string,
): { calls: string[][]; run(args: readonly string[]): string; resolveSession(name: string): string } {
  const calls: string[][] = [];
  const responses = new Map<string, string>([
    ["display-message -p -t $9:0 #{window_id}", windowId],
    ["list-windows -t $4 -F #{window_index}\t#{window_id}", controlWindows],
  ]);
  return {
    calls,
    resolveSession(name: string): string {
      if (name === "firstmate-mandala") return "$9";
      if (name === "pandamate:home") return "$4";
      throw new Error(`Unknown tmux session: ${name}`);
    },
    run(args: readonly string[]): string {
      calls.push([...args]);
      return responses.get(args.join(" ")) ?? "";
    },
  };
}

test("links a FirstMate window as a fresh Pandamate home tab and shows tabs", () => {
  const tmux = tabTmux("@7", "0\t@1");
  const result = openSessionAsControlTab(tmux, "firstmate-mandala");

  assert.equal(result, "$9");
  assert.deepEqual(tmux.calls, [
    ["display-message", "-p", "-t", "$9:0", "#{window_id}"],
    ["list-windows", "-t", "$4", "-F", "#{window_index}\t#{window_id}"],
    ["link-window", "-s", "$9:0", "-t", "$4:1"],
    ["set-window-option", "-t", "$4:1", "automatic-rename", "off"],
    ["rename-window", "-t", "$4:1", "mandala"],
    ["set-option", "-t", "$4", "status", "on"],
    ["select-window", "-t", "$4:1"],
  ]);
});

test("re-opening an already linked project just selects its existing tab", () => {
  const tmux = tabTmux("@7", "0\t@1\n1\t@7");
  const result = openSessionAsControlTab(tmux, "firstmate-mandala");

  assert.equal(result, "$9");
  assert.deepEqual(tmux.calls, [
    ["display-message", "-p", "-t", "$9:0", "#{window_id}"],
    ["list-windows", "-t", "$4", "-F", "#{window_index}\t#{window_id}"],
    ["set-option", "-t", "$4", "status", "on"],
    ["select-window", "-t", "$4:1"],
  ]);
});

test("refuses to open control sessions or non-project sessions as tabs", () => {
  const tmux = tabTmux("@7", "0\t@1");
  assert.throws(() => openSessionAsControlTab(tmux, "pandamate:home"));
  assert.throws(() => openSessionAsControlTab(tmux, "randomsession"));
  assert.deepEqual(tmux.calls, []);
});

function closeTmux(
  windowId: string,
  controlWindows: string,
  options: { homeMissing?: boolean; projectMissing?: boolean } = {},
): { calls: string[][]; run(args: readonly string[]): string; resolveSession(name: string): string } {
  const calls: string[][] = [];
  const responses = new Map<string, string>([
    ["display-message -p -t $9:0 #{window_id}", windowId],
    ["list-windows -t $4 -F #{window_index}\t#{window_id}", controlWindows],
  ]);
  return {
    calls,
    resolveSession(name: string): string {
      if (name === "pandamate:home") {
        if (options.homeMissing) {
          throw new Error("Unknown tmux session: pandamate:home");
        }
        return "$4";
      }
      if (name === "firstmate-mandala") {
        if (options.projectMissing) {
          throw new Error("Unknown tmux session: firstmate-mandala");
        }
        return "$9";
      }
      throw new Error(`Unknown tmux session: ${name}`);
    },
    run(args: readonly string[]): string {
      calls.push([...args]);
      return responses.get(args.join(" ")) ?? "";
    },
  };
}

test("closing the last project tab unlinks it and restores clean home", () => {
  const tmux = closeTmux("@7", "0\t@1\n1\t@7");
  const closed = closeControlTab(tmux, "firstmate-mandala");

  assert.equal(closed, true);
  assert.deepEqual(tmux.calls, [
    ["display-message", "-p", "-t", "$9:0", "#{window_id}"],
    ["list-windows", "-t", "$4", "-F", "#{window_index}\t#{window_id}"],
    ["unlink-window", "-t", "$4:1"],
    ["set-option", "-t", "$4", "status", "off"],
    ["select-window", "-t", "$4:0"],
  ]);
});

test("closing one of several tabs keeps the tab strip and returns home", () => {
  const tmux = closeTmux("@7", "0\t@1\n1\t@7\n2\t@9");
  const closed = closeControlTab(tmux, "firstmate-mandala");

  assert.equal(closed, true);
  assert.deepEqual(tmux.calls, [
    ["display-message", "-p", "-t", "$9:0", "#{window_id}"],
    ["list-windows", "-t", "$4", "-F", "#{window_index}\t#{window_id}"],
    ["unlink-window", "-t", "$4:1"],
    ["select-window", "-t", "$4:0"],
  ]);
});

test("closing a project that is not currently a tab is a no-op", () => {
  const tmux = closeTmux("@7", "0\t@1");
  const closed = closeControlTab(tmux, "firstmate-mandala");

  assert.equal(closed, false);
  assert.deepEqual(tmux.calls, [
    ["display-message", "-p", "-t", "$9:0", "#{window_id}"],
    ["list-windows", "-t", "$4", "-F", "#{window_index}\t#{window_id}"],
  ]);
});

test("closing a tab when home is not running is a safe no-op", () => {
  const tmux = closeTmux("@7", "0\t@1", { homeMissing: true });
  const closed = closeControlTab(tmux, "firstmate-mandala");

  assert.equal(closed, false);
  assert.deepEqual(tmux.calls, []);
});

test("close refuses control sessions and non-project sessions", () => {
  const tmux = closeTmux("@7", "0\t@1");
  assert.throws(() => closeControlTab(tmux, "pandamate:home"));
  assert.throws(() => closeControlTab(tmux, "randomsession"));
  assert.deepEqual(tmux.calls, []);
});

test("iTerm attach command only accepts stable tmux session ids", () => {
  assert.equal(
    attachCommandForSessionId("$12", "/opt/homebrew/bin/tmux"),
    "/opt/homebrew/bin/tmux attach-session -t '$12'",
  );
  assert.throws(() =>
    attachCommandForSessionId("firstmate; echo unsafe", "/usr/bin/tmux"),
  );
  assert.throws(() => attachCommandForSessionId("$12", "tmux"));
  assert.throws(() =>
    attachCommandForSessionId("$12", '/tmp/tmux"; do shell script "id'),
  );
});

test("delivers graceful shutdown to the active pane in window zero", () => {
  const deliveries: Array<{ pane: string; text: string }> = [];
  const result = requestGracefulSessionShutdown(
    {
      activePaneInWindowZero: () => "$12:@3.%7",
      sendTextAndEnter: (pane, text) => {
        deliveries.push({ pane, text });
      },
    },
    "firstmate",
  );

  assert.deepEqual(result, { pane: "$12:@3.%7" });
  assert.equal(deliveries[0]?.pane, "$12:@3.%7");
  assert.match(deliveries[0]?.text ?? "", /Всех матросов увольняем/);
  assert.match(deliveries[0]?.text ?? "", /Arcadia/);
  assert.match(deliveries[0]?.text ?? "", /Не трогай чужие проекты/);
});

test("graceful shutdown rejects control-plane and multiline session names", () => {
  const tmux = {
    activePaneInWindowZero: () => "$12:@3.%7",
    sendTextAndEnter: () => {},
  };

  assert.throws(() =>
    requestGracefulSessionShutdown(tmux, "pandamate:home"),
  );
  assert.throws(() =>
    requestGracefulSessionShutdown(tmux, "firstmate\nother"),
  );
});

test("delivers reset as graceful stop followed by deploy without closing main pane", () => {
  const deliveries: string[] = [];
  const result = requestFirstMateReset(
    {
      activePaneInWindowZero: () => "$12:@3.%7",
      sendTextAndEnter: (_pane, text) => deliveries.push(text),
    },
    "firstmate",
  );

  assert.deepEqual(result, { pane: "$12:@3.%7" });
  assert.match(deliveries[0] ?? "", /полный Reset/);
  assert.match(deliveries[0] ?? "", /Watcher/);
  assert.match(deliveries[0] ?? "", /основную tmux-сессию не закрывай/);
  assert.match(deliveries[0] ?? "", /graceful stop и последующий deploy/);
});

test("resolves window zero active pane and sends text followed by Enter", () => {
  const runner = new RecordingRunner([
    "$12\tfirstmate",
    "$12:@3.%7",
    "",
    "",
  ]);
  const tmux = new TmuxClient({ runner });
  const pane = tmux.activePaneInWindowZero("firstmate");
  tmux.sendTextAndEnter(pane, "shutdown now");

  assert.equal(pane, "$12:@3.%7");
  assert.deepEqual(runner.calls.slice(1), [
    {
      executable: "tmux",
      args: [
        "list-panes",
        "-t",
        "$12:0",
        "-f",
        "#{pane_active}",
        "-F",
        "#{session_id}:#{window_id}.#{pane_id}",
      ],
    },
    {
      executable: "tmux",
      args: ["send-keys", "-t", "$12:@3.%7", "-l", "shutdown now"],
    },
    {
      executable: "tmux",
      args: ["send-keys", "-t", "$12:@3.%7", "Enter"],
    },
  ]);
});
