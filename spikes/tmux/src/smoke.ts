import process from "node:process";

import {
  targetForPandamateService,
  targetForProject,
  TmuxClient,
} from "@pandamate/runtime-tmux";

const socketName = `pandamate-spike-${process.pid}`;
const tmux = new TmuxClient({ socketName });
const targets = [
  targetForPandamateService("home"),
  targetForProject("mandala"),
];

try {
  for (const target of targets) {
    tmux.createDetached(target, ["sleep", "60"]);
  }

  const actual = [...tmux.listSessions()].sort();
  const expected = [...targets].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Unexpected isolated tmux sessions: ${JSON.stringify(actual)}`,
    );
  }

  process.stdout.write(
    [
      `tmux ${tmux.run(["-V"])}`,
      `isolated socket: ${socketName}`,
      `created: ${actual.join(", ")}`,
      "safe origin/return target model: verified by unit test",
      "smoke: PASS",
      "",
    ].join("\n"),
  );
} finally {
  for (const target of targets) {
    if (tmux.hasSession(target)) {
      tmux.killSession(target);
    }
  }
}
