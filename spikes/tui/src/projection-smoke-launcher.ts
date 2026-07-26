import { fork } from "node:child_process";
import { resolve } from "node:path";
import process from "node:process";

import { demoProjects } from "./model.ts";

const child = fork(resolve(import.meta.dirname, "index.ts"), [], {
  env: process.env,
  execArgv: ["--experimental-ffi"],
  stdio: ["inherit", "inherit", "inherit", "ipc"],
});

const timer = setTimeout(() => {
  child.send({
    type: "projection.update",
    projects: [
      ...demoProjects,
      {
        name: "Live Project",
        profile: "FirstMateGit",
        sessionName: "firstmate-live-project",
        state: "starting",
        summary: "FirstMate is starting from a live projection.",
        lastMessage: null,
        heartbeatSeconds: null,
        tmuxWindowCount: 1,
      },
    ],
    services: [
      {
        name: "pandamate:write",
        state: "running",
        summary: "1 windows · 1 live panes · 1 attached",
      },
      {
        name: "pandamate:home",
        state: "running",
        summary: "1 windows · 1 live panes · 0 attached",
      },
    ],
    events: [
      {
        sequence: 1,
        timestamp: "2026-07-26T12:00:00.000Z",
        type: "project.registered",
        subject: "mandala",
        detail: "Mandala · git · /workspace/mandala",
      },
      {
        sequence: 2,
        timestamp: "2026-07-26T12:00:01.000Z",
        type: "project.start.requested",
        subject: "live-project",
        detail: "FirstMateGit",
      },
    ],
  });
}, 500);

child.on("message", () => {
  // The smoke only verifies parent-to-TUI projection updates.
});
child.on("error", (error) => {
  clearTimeout(timer);
  process.stderr.write(`${error.stack ?? error.message}\n`);
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  clearTimeout(timer);
  if (signal) {
    process.kill(process.pid, signal);
  } else {
    process.exitCode = code ?? 1;
  }
});
