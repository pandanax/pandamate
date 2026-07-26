import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import process from "node:process";

import {
  targetForPandamateService,
  TmuxClient,
} from "@pandamate/runtime-tmux";
import { waitFor } from "./wait.ts";

interface ProcessSample {
  readonly elapsedSeconds: number;
  readonly cpuPercent: number;
  readonly rssKiB: number;
}

function parseDurationSeconds(): number {
  if (process.argv.includes("--24h")) {
    return 24 * 60 * 60;
  }
  if (process.argv.includes("--quick")) {
    return 15;
  }
  const argument = process.argv.find((value) =>
    value.startsWith("--duration-seconds="),
  );
  if (!argument) {
    return 60;
  }
  const seconds = Number(argument.slice("--duration-seconds=".length));
  if (!Number.isInteger(seconds) || seconds < 10 || seconds > 24 * 60 * 60) {
    throw new Error(`Invalid probe duration: ${argument}`);
  }
  return seconds;
}

function sampleProcess(pid: number, elapsedSeconds: number): ProcessSample {
  const output = execFileSync(
    "ps",
    ["-o", "%cpu=", "-o", "rss=", "-p", String(pid)],
    { encoding: "utf8" },
  ).trim();
  const [cpuValue, rssValue] = output.split(/\s+/);
  const cpuPercent = Number(cpuValue);
  const rssKiB = Number(rssValue);
  if (!Number.isFinite(cpuPercent) || !Number.isFinite(rssKiB)) {
    throw new Error(`Malformed ps sample: ${output}`);
  }
  return { elapsedSeconds, cpuPercent, rssKiB };
}

function average(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

const durationSeconds = parseDurationSeconds();
const sampleIntervalSeconds = durationSeconds <= 60 ? 2 : 30;
const socketName = `pandamate-idle-${process.pid}`;
const tmux = new TmuxClient({ socketName });
const keeper = targetForPandamateService("probe-keeper");
const tui = targetForPandamateService("idle-probe");
const tuiEntry = resolve(import.meta.dirname, "../../tui/src/index.ts");
const samples: ProcessSample[] = [];

try {
  tmux.createDetached(keeper, ["sleep", "60"]);
  tmux.setGlobalEnvironment("PANDAMATE_NODE", process.execPath);
  tmux.setGlobalEnvironment("PANDAMATE_TUI_ENTRY", tuiEntry);
  tmux.run([
    "new-session",
    "-d",
    "-x",
    "120",
    "-y",
    "35",
    "-s",
    tui,
    'exec "$PANDAMATE_NODE" --experimental-ffi "$PANDAMATE_TUI_ENTRY"',
  ]);

  await waitFor(
    () => tmux.capturePane(tui).includes("PANDAMATE"),
    "the idle probe TUI",
  );
  const pid = tmux.panePid(tui);
  const startedAt = Date.now();

  while ((Date.now() - startedAt) / 1_000 < durationSeconds) {
    const elapsedSeconds = (Date.now() - startedAt) / 1_000;
    samples.push(sampleProcess(pid, elapsedSeconds));
    await new Promise<void>((resolveDelay) =>
      setTimeout(resolveDelay, sampleIntervalSeconds * 1_000),
    );
  }

  const cpuValues = samples.map((sample) => sample.cpuPercent);
  const rssValues = samples.map((sample) => sample.rssKiB);
  const firstRss = rssValues[0] ?? 0;
  const lastRss = rssValues.at(-1) ?? 0;
  const averageCpu = average(cpuValues);

  process.stdout.write(
    [
      `duration: ${durationSeconds}s`,
      `samples: ${samples.length}`,
      `pid: ${pid}`,
      `average CPU: ${averageCpu.toFixed(2)}%`,
      `peak CPU: ${Math.max(...cpuValues).toFixed(2)}%`,
      `initial RSS: ${(firstRss / 1024).toFixed(1)} MiB`,
      `peak RSS: ${(Math.max(...rssValues) / 1024).toFixed(1)} MiB`,
      `RSS delta: ${((lastRss - firstRss) / 1024).toFixed(1)} MiB`,
      `idle CPU target (<2%): ${averageCpu < 2 ? "PASS" : "FAIL"}`,
      "",
    ].join("\n"),
  );

  if (durationSeconds >= 60 && averageCpu >= 2) {
    process.exitCode = 1;
  }
} finally {
  if (tmux.hasSession(tui)) {
    tmux.sendLiteralKey(tui, "q");
  }
  for (const target of [tui, keeper]) {
    if (tmux.hasSession(target)) {
      tmux.killSession(target);
    }
  }
}
