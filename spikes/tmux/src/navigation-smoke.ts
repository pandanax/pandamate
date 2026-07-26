import { spawn, type ChildProcess } from "node:child_process";
import process from "node:process";

import {
  targetForPandamateService,
  targetForProject,
  TmuxClient,
} from "@pandamate/runtime-tmux";
import { waitFor } from "./wait.ts";

const socketName = `pandamate-navigation-${process.pid}`;
const tmux = new TmuxClient({ socketName });
const home = targetForPandamateService("home");
const project = targetForProject("mandala");
let attachedClient: ChildProcess | null = null;

try {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("navigation-smoke must run in a real PTY");
  }
  tmux.createDetached(home, ["sleep", "60"]);
  tmux.createDetached(project, ["sleep", "60"]);

  attachedClient = spawn(
    "tmux",
    [
      "-L",
      socketName,
      "attach-session",
      "-t",
      tmux.resolveSession(home),
    ],
    {
      env: {
        ...process.env,
        TERM:
          !process.env.TERM || process.env.TERM === "dumb"
            ? "xterm-256color"
            : process.env.TERM,
      },
      stdio: "inherit",
    },
  );

  await waitFor(
    () => {
      try {
        return tmux.listClients().length === 1;
      } catch {
        return false;
      }
    },
    "an attached tmux client",
  );

  const origin = tmux.listClients()[0];
  if (!origin) {
    throw new Error("Attached client disappeared");
  }

  tmux.switchClient(origin.tty, project);
  await waitFor(
    () => tmux.listClients()[0]?.sessionName === project,
    "switch to the FirstMate target",
  );

  tmux.switchClient(origin.tty, origin.paneId);
  await waitFor(
    () => tmux.listClients()[0]?.sessionName === home,
    "return to the exact Pandamate origin",
  );

  tmux.run(["detach-client", "-t", origin.tty]);
  await new Promise<void>((resolveExit) => {
    if (attachedClient?.exitCode !== null) {
      resolveExit();
      return;
    }
    attachedClient?.once("exit", () => resolveExit());
  });

  process.stdout.write(
    [
      `client: ${origin.tty}`,
      `origin: ${origin.paneId}`,
      `route: ${home} -> ${project} -> ${home}`,
      "navigation smoke: PASS",
      "",
    ].join("\n"),
  );
} finally {
  attachedClient?.kill("SIGTERM");
  for (const target of [home, project]) {
    if (tmux.hasSession(target)) {
      tmux.killSession(target);
    }
  }
}
