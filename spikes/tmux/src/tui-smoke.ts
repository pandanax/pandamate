import { resolve } from "node:path";
import process from "node:process";

import { targetForProject, TmuxClient } from "@pandamate/runtime-tmux";
import { waitFor } from "./wait.ts";

const socketName = `pandamate-tui-${process.pid}`;
const tmux = new TmuxClient({ socketName });
const keeper = targetForProject("smoke-keeper");
const tui = targetForProject("tui");
const tuiEntry = resolve(
  import.meta.dirname,
  "../../tui/src/projection-smoke-launcher.ts",
);
const cleanupMarker = "PANDAMATE_TUI_CLEAN";

try {
  tmux.createDetached(keeper, ["sleep", "60"]);
  tmux.setGlobalEnvironment("PANDAMATE_NODE", process.execPath);
  tmux.setGlobalEnvironment("PANDAMATE_TUI_ENTRY", tuiEntry);
  tmux.setGlobalEnvironment(
    "PANDAMATE_EVENTS_JSON",
    JSON.stringify([
      {
        sequence: 1,
        timestamp: "2026-07-26T12:00:00.000Z",
        type: "project.registered",
        subject: "mandala",
        detail: "Mandala · git · /workspace/mandala",
      },
    ]),
  );
  tmux.run([
    "new-session",
    "-d",
    "-x",
    "120",
    "-y",
    "35",
    "-s",
    tui,
    `/bin/zsh -lc '"$PANDAMATE_NODE" --experimental-ffi "$PANDAMATE_TUI_ENTRY"; printf "\\n${cleanupMarker}\\n"; exec sleep 60'`,
  ]);

  await waitFor(
    () => tmux.capturePane(tui).includes("PANDAMATE"),
    "the first OpenTUI frame inside tmux",
  );
  const wide = tmux.capturePane(tui);
  if (!wide.includes("LIVE ACTIVITY") || !wide.includes("SELECTED: MANDALA")) {
    throw new Error("Wide TUI frame is missing required panels");
  }
  // At this width a Fleet row shows only the first word of a project name, so
  // the injected "Live Project" is matched by its name's first word together
  // with the one state no demo project is in.
  await waitFor(
    () =>
      tmux.capturePane(tui).includes("Live") &&
      tmux.capturePane(tui).includes("starting") &&
      tmux.capturePane(tui).includes("PANDAMATE SERVICES") &&
      tmux.capturePane(tui).includes("write"),
    "a live IPC projection update in the already-open Fleet",
  );
  const separated = tmux.capturePane(tui);
  if (separated.includes("SELECTED: PANDAMATE:WRITE")) {
    throw new Error("Pandamate write service leaked into the project Fleet");
  }

  tmux.resizeWindow(tui, 70, 24);
  await waitFor(
    () => tmux.capturePane(tui).includes("COMPACT"),
    "the compact layout after resize",
  );

  tmux.resizeWindow(tui, 120, 35);
  tmux.sendLiteralKey(tui, "e");
  await waitFor(
    () =>
      tmux.capturePane(tui).includes("EVENT JOURNAL") &&
      tmux.capturePane(tui).includes("project.registered"),
    "the top-level event journal from Home",
  );
  tmux.run([
    "send-keys",
    "-t",
    tmux.resolveSession(tui),
    "Escape",
  ]);
  await waitFor(
    () => tmux.capturePane(tui).includes("LIVE ACTIVITY"),
    "return from the event journal to Home",
  );
  tmux.sendLiteralKey(tui, "s");
  await waitFor(
    () =>
      tmux.capturePane(tui).includes("PANDAMATE SERVICES") &&
      tmux.capturePane(tui).includes("home") &&
      tmux.capturePane(tui).includes("write"),
    "the dedicated Pandamate services screen",
  );
  tmux.run([
    "send-keys",
    "-t",
    tmux.resolveSession(tui),
    "Escape",
  ]);
  await waitFor(
    () => tmux.capturePane(tui).includes("LIVE ACTIVITY"),
    "return from Pandamate services to Home",
  );
  tmux.sendLiteralKey(tui, "i");
  await waitFor(
    () => tmux.capturePane(tui).includes("WRITE TO PANDAMATE"),
    "the Pandamate writing window",
  );
  tmux.run([
    "send-keys",
    "-t",
    tmux.resolveSession(tui),
    "Escape",
  ]);
  await waitFor(
    () => tmux.capturePane(tui).includes("LIVE ACTIVITY"),
    "return from Pandamate input to Home",
  );
  tmux.sendLiteralKey(tui, "j");
  await waitFor(
    () => tmux.capturePane(tui).includes("SELECTED: ARC-1234"),
    "keyboard selection inside tmux",
  );

  const sendKey = (key: string): void => {
    tmux.run(["send-keys", "-t", tmux.resolveSession(tui), "-l", key]);
  };
  sendKey("X");
  await waitFor(
    () =>
      tmux.capturePane(tui).includes("CONFIRM FULL PANDAMATE SHUTDOWN") &&
      tmux.capturePane(tui).includes("left alone"),
    "the full shutdown confirmation",
  );
  sendKey("n");
  await waitFor(
    () => tmux.capturePane(tui).includes("Full shutdown cancelled."),
    "a cancelled full shutdown returning Home",
  );
  sendKey("X");
  await waitFor(
    () => tmux.capturePane(tui).includes("CONFIRM FULL PANDAMATE SHUTDOWN"),
    "the full shutdown confirmation a second time",
  );
  sendKey("y");
  await waitFor(
    () =>
      tmux.capturePane(tui).includes("CLOSING PANDAMATE") &&
      tmux.capturePane(tui).includes("firstmate-live-project") &&
      tmux.capturePane(tui).includes("Left untouched: work"),
    "live shutdown progress pushed by the host",
  );
  await waitFor(
    () => tmux.capturePane(tui).includes("Smoke fixture: the shutdown stops here."),
    "a failed shutdown reported on screen",
  );
  tmux.run(["send-keys", "-t", tmux.resolveSession(tui), "Escape"]);
  await waitFor(
    () => tmux.capturePane(tui).includes("LIVE ACTIVITY"),
    "return Home from a failed shutdown",
  );

  tmux.sendLiteralKey(tui, "q");
  await waitFor(
    () => tmux.capturePane(tui).includes(cleanupMarker),
    "OpenTUI alternate-screen cleanup",
  );

  process.stdout.write(
    [
      "wide frame: PASS",
      "compact resize: PASS",
      "Unicode frame: PASS",
      "Home event journal: PASS",
      "Pandamate writing window: PASS",
      "live Fleet projection: PASS",
      "Fleet/services separation: PASS",
      "Pandamate services screen: PASS",
      "full shutdown confirmation and live progress: PASS",
      "keyboard input: PASS",
      "alternate-screen cleanup: PASS",
      "tmux TUI smoke: PASS",
      "",
    ].join("\n"),
  );
} catch (error) {
  if (tmux.hasSession(tui)) {
    process.stderr.write(`\n--- tmux pane diagnostics ---\n${tmux.capturePane(tui)}\n`);
  }
  throw error;
} finally {
  for (const target of [tui, keeper]) {
    if (tmux.hasSession(target)) {
      tmux.killSession(target);
    }
  }
}
