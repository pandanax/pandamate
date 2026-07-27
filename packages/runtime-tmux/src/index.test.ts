import assert from "node:assert/strict";
import test from "node:test";

import {
  attachCommandForSessionId,
  discoverTmuxSessions,
  closeControlTab,
  configureControlStatusBar,
  controlTabForSession,
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
    "$6|pandamate:mandala",
    "",
  ]);
  const tmux = new TmuxClient({ runner });
  tmux.renameSession("pandamate:mandala", "firstmate-mandala");
  assert.deepEqual(runner.calls, [
    {
      executable: "tmux",
      args: ["list-sessions", "-F", "#{session_id}|#{session_name}"],
    },
    {
      executable: "tmux",
      args: ["rename-session", "-t", "$6", "firstmate-mandala"],
    },
  ]);
});

test("discovers and aggregates sessions from bounded tmux formats", () => {
  const runner = new RecordingRunner([
    "$2|0|2|zeta\n$1|1|1|alpha",
    "$2|0|zsh|/workspace/zeta\n$2|1|node|/workspace/zeta\n$1|0|node|/workspace/alpha",
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

test("asks tmux for printable formats only, never control characters", () => {
  const runner = new RecordingRunner([
    "$1|0|1|alpha",
    "$1|0|node|/workspace/alpha",
    "$1|alpha",
    "/dev/ttys004|$1:@2.%3|alpha",
  ]);
  const tmux = new TmuxClient({ runner });
  discoverTmuxSessions(tmux);
  tmux.resolveSession("alpha");
  tmux.listClients();

  // tmux rewrites non-printable bytes in -F output as `_` when its client has
  // no UTF-8 ctype, which silently broke every tab-separated format inside the
  // daemon launched from the macOS app bundle.
  for (const call of runner.calls) {
    const format = call.args[call.args.indexOf("-F") + 1] ?? "";
    assert.doesNotMatch(format, /[\u0000-\u001f\u007f]/);
  }
});

test("keeps free-form fields that contain the field delimiter", () => {
  const runner = new RecordingRunner([
    "$3|0|1|weird|name",
    "$3|0|node|/workspace/weird|dir",
    "$3|weird|name",
  ]);
  const tmux = new TmuxClient({ runner });

  assert.deepEqual(discoverTmuxSessions(tmux), [
    {
      id: "$3",
      name: "weird|name",
      attachedClients: 0,
      windowCount: 1,
      livePaneCount: 1,
      commands: ["node"],
      paths: ["/workspace/weird|dir"],
    },
  ]);
  assert.equal(tmux.resolveSession("weird|name"), "$3");
});

test("reports mangled session rows instead of a missing session", () => {
  const runner = new RecordingRunner(["$9_firstmate-pandamate"]);
  const tmux = new TmuxClient({ runner });
  assert.throws(
    () => tmux.resolveSession("firstmate-pandamate"),
    /Malformed tmux session row/,
  );
});

test("rejects malformed discovery evidence", () => {
  const unknownPane = new RecordingRunner([
    "$1|0|1|alpha",
    "$2|0|node|/workspace",
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
    ["list-windows -t $4 -F #{window_index}|#{window_id}|#{window_name}", controlWindows],
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

function structuralCalls(calls: readonly string[][]): readonly string[][] {
  return calls.filter(
    (call) =>
      call[0] !== "set-option" &&
      !(call[0] === "set-window-option" && call[3]?.startsWith("window-status")),
  );
}

test("dresses a Pandamate session with tabs and always-visible key hints", () => {
  const tmux = tabTmux("@7", "0|@1|home");
  configureControlStatusBar(tmux, "$4");

  const options = new Map(
    tmux.calls
      .filter(
        (call) => call[0] === "set-option" || call[0] === "set-window-option",
      )
      .map((call) => [call[3] ?? "", call[4] ?? ""]),
  );
  assert.equal(options.get("status"), "on");
  assert.equal(options.get("status-position"), "bottom");
  assert.match(options.get("status-right") ?? "", /\^b 0 home/);
  assert.match(options.get("status-right") ?? "", /\^b d detach/);
  assert.match(options.get("window-status-current-format") ?? "", /#I #W/);
  // The tab strip reads each window's own options, never the session's.
  assert.deepEqual(
    tmux.calls
      .filter((call) => call[0] === "set-window-option")
      .map((call) => call[2]),
    ["@1", "@1", "@1"],
  );
  assert.throws(() => configureControlStatusBar(tmux, "pandamate:home"));
});

test("links a FirstMate window as a fresh Pandamate home tab and shows tabs", () => {
  const tmux = tabTmux("@7", "0|@1|home");
  const result = openSessionAsControlTab(tmux, "firstmate-mandala");

  assert.equal(result, "$9");
  assert.deepEqual(structuralCalls(tmux.calls), [
    ["display-message", "-p", "-t", "$9:0", "#{window_id}"],
    [
      "list-windows",
      "-t",
      "$4",
      "-F",
      "#{window_index}|#{window_id}|#{window_name}",
    ],
    ["link-window", "-s", "$9:0", "-t", "$4:1"],
    ["set-window-option", "-t", "$4:1", "automatic-rename", "off"],
    ["rename-window", "-t", "$4:1", "mandala"],
    [
      "list-windows",
      "-t",
      "$4",
      "-F",
      "#{window_index}|#{window_id}|#{window_name}",
    ],
    ["select-window", "-t", "$4:1"],
  ]);
});

test("re-opening an already linked project just selects its existing tab", () => {
  const tmux = tabTmux("@7", "0|@1|home\n1|@7|mandala");
  const result = openSessionAsControlTab(tmux, "firstmate-mandala");

  assert.equal(result, "$9");
  assert.deepEqual(structuralCalls(tmux.calls), [
    ["display-message", "-p", "-t", "$9:0", "#{window_id}"],
    [
      "list-windows",
      "-t",
      "$4",
      "-F",
      "#{window_index}|#{window_id}|#{window_name}",
    ],
    [
      "list-windows",
      "-t",
      "$4",
      "-F",
      "#{window_index}|#{window_id}|#{window_name}",
    ],
    ["select-window", "-t", "$4:1"],
  ]);
});

test("names the home tab a FirstMate occupies, and reports none when unlinked", () => {
  assert.deepEqual(
    controlTabForSession(
      tabTmux("@7", "0|@1|home\n1|@7|mandala"),
      "firstmate-mandala",
    ),
    { index: 1, name: "mandala" },
  );
  assert.equal(
    controlTabForSession(tabTmux("@7", "0|@1|home"), "firstmate-mandala"),
    null,
  );
  assert.equal(
    controlTabForSession(tabTmux("@7", "0|@1|home"), "firstmate-gone"),
    null,
  );
});

test("refuses to open control sessions or non-project sessions as tabs", () => {
  const tmux = tabTmux("@7", "0|@1|home");
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
    ["list-windows -t $4 -F #{window_index}|#{window_id}|#{window_name}", controlWindows],
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
  const tmux = closeTmux("@7", "0|@1|home\n1|@7|mandala");
  const closed = closeControlTab(tmux, "firstmate-mandala");

  assert.equal(closed, true);
  assert.deepEqual(tmux.calls, [
    ["display-message", "-p", "-t", "$9:0", "#{window_id}"],
    [
      "list-windows",
      "-t",
      "$4",
      "-F",
      "#{window_index}|#{window_id}|#{window_name}",
    ],
    ["unlink-window", "-t", "$4:1"],
    ["select-window", "-t", "$4:0"],
  ]);
});

test("closing one of several tabs keeps the tab strip and returns home", () => {
  const tmux = closeTmux("@7", "0|@1|home\n1|@7|mandala\n2|@9|zeta");
  const closed = closeControlTab(tmux, "firstmate-mandala");

  assert.equal(closed, true);
  assert.deepEqual(tmux.calls, [
    ["display-message", "-p", "-t", "$9:0", "#{window_id}"],
    [
      "list-windows",
      "-t",
      "$4",
      "-F",
      "#{window_index}|#{window_id}|#{window_name}",
    ],
    ["unlink-window", "-t", "$4:1"],
    ["select-window", "-t", "$4:0"],
  ]);
});

test("closing a project that is not currently a tab is a no-op", () => {
  const tmux = closeTmux("@7", "0|@1|home");
  const closed = closeControlTab(tmux, "firstmate-mandala");

  assert.equal(closed, false);
  assert.deepEqual(tmux.calls, [
    ["display-message", "-p", "-t", "$9:0", "#{window_id}"],
    [
      "list-windows",
      "-t",
      "$4",
      "-F",
      "#{window_index}|#{window_id}|#{window_name}",
    ],
  ]);
});

test("closing a tab when home is not running is a safe no-op", () => {
  const tmux = closeTmux("@7", "0|@1|home", { homeMissing: true });
  const closed = closeControlTab(tmux, "firstmate-mandala");

  assert.equal(closed, false);
  assert.deepEqual(tmux.calls, []);
});

test("close refuses control sessions and non-project sessions", () => {
  const tmux = closeTmux("@7", "0|@1|home");
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
    "$12|firstmate",
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
