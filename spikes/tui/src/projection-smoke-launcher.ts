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

child.on("message", (value: unknown) => {
  // A full shutdown is driven by the host, so the smoke plays that part: it
  // answers the request with the progress the real launcher would push, ending
  // in a failure — the one phase that hands the keyboard back, so the smoke can
  // leave the screen again.
  if (
    typeof value !== "object" ||
    value === null ||
    (value as Record<string, unknown>).action !== "pandamate.shutdown-all"
  ) {
    return;
  }
  child.send({
    type: "shutdown.progress",
    phase: "firstmates",
    headline: "Asking 1 FirstMate to shut down gracefully…",
    sessions: [
      {
        session: "firstmate-live-project",
        outcome: "requested",
        detail: "Shutdown sent to window 0 ($1:@2.%3)",
      },
    ],
    foreign: ["work"],
  });
  setTimeout(() => {
    child.send({
      type: "shutdown.progress",
      phase: "failed",
      headline: "Smoke fixture: the shutdown stops here.",
      sessions: [
        {
          session: "firstmate-live-project",
          outcome: "closed",
          detail: "Closed itself gracefully",
        },
      ],
      foreign: ["work"],
    });
  }, 300);
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
