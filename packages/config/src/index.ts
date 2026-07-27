import { chmodSync, mkdirSync } from "node:fs";
import { homedir, tmpdir, userInfo } from "node:os";
import { isAbsolute, join, normalize } from "node:path";

export interface PandamateConfig {
  readonly stateDirectory: string;
  readonly runtimeDirectory: string;
  readonly databasePath: string;
  readonly socketPath: string;
  readonly lockPath: string;
  readonly logPath: string;
  readonly heartbeatDirectory: string;
  readonly hookSpoolDirectory: string;
  readonly memoryDirectory: string;
  readonly backupsDirectory: string;
  readonly tmuxSocketName: string | undefined;
  readonly firstMateAdapter: "claude-code" | "fake";
  readonly claudeExecutable: string;
  readonly fakeFirstMateEntry: string | undefined;
  readonly reconcileIntervalMs: number;
  readonly heartbeatStaleMs: number;
  readonly shutdownGraceMs: number;
  readonly watcherRestartBackoffMs: number;
}

function configuredPath(
  value: string | undefined,
  fallback: string,
  label: string,
): string {
  const path = value ?? fallback;
  if (
    !isAbsolute(path) ||
    normalize(path) !== path ||
    path.length > 1024 ||
    path.includes("\u0000")
  ) {
    throw new Error(`${label} must be a normalized absolute path`);
  }
  return path;
}

export function loadConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): PandamateConfig {
  const stateDirectory = configuredPath(
    environment.PANDAMATE_STATE_DIR,
    join(homedir(), "Library", "Application Support", "Pandamate"),
    "PANDAMATE_STATE_DIR",
  );
  const runtimeDirectory = configuredPath(
    environment.PANDAMATE_RUNTIME_DIR,
    join(tmpdir(), `pandamate-${userInfo().uid}`),
    "PANDAMATE_RUNTIME_DIR",
  );
  const socketPath = join(runtimeDirectory, "pandamated.sock");
  if (Buffer.byteLength(socketPath) > 100) {
    throw new Error("Pandamate Unix socket path is too long");
  }
  const tmuxSocketName = environment.PANDAMATE_TMUX_SOCKET_NAME;
  if (
    tmuxSocketName !== undefined &&
    !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(tmuxSocketName)
  ) {
    throw new Error("PANDAMATE_TMUX_SOCKET_NAME is invalid");
  }
  const firstMateAdapter =
    environment.PANDAMATE_FIRSTMATE_ADAPTER ?? "claude-code";
  if (firstMateAdapter !== "claude-code" && firstMateAdapter !== "fake") {
    throw new Error("PANDAMATE_FIRSTMATE_ADAPTER is invalid");
  }
  const claudeExecutable = configuredPath(
    environment.PANDAMATE_CLAUDE_EXECUTABLE,
    join(homedir(), ".local", "bin", "claude"),
    "PANDAMATE_CLAUDE_EXECUTABLE",
  );
  const fakeFirstMateEntry = environment.PANDAMATE_FAKE_FIRSTMATE_ENTRY;
  if (
    fakeFirstMateEntry !== undefined &&
    configuredPath(
      fakeFirstMateEntry,
      fakeFirstMateEntry,
      "PANDAMATE_FAKE_FIRSTMATE_ENTRY",
    ) !== fakeFirstMateEntry
  ) {
    throw new Error("PANDAMATE_FAKE_FIRSTMATE_ENTRY is invalid");
  }
  if (firstMateAdapter === "fake" && !fakeFirstMateEntry) {
    throw new Error(
      "PANDAMATE_FAKE_FIRSTMATE_ENTRY is required for the fake adapter",
    );
  }
  const boundedMilliseconds = (
    name: string,
    fallback: number,
    minimum: number,
    maximum: number,
  ): number => {
    const value = Number(environment[name] ?? fallback);
    if (
      !Number.isSafeInteger(value) ||
      value < minimum ||
      value > maximum
    ) {
      throw new Error(`${name} is invalid`);
    }
    return value;
  };
  return {
    stateDirectory,
    runtimeDirectory,
    databasePath: join(stateDirectory, "state.sqlite3"),
    socketPath,
    lockPath: join(runtimeDirectory, "pandamated.lock"),
    logPath: join(stateDirectory, "pandamated.jsonl"),
    heartbeatDirectory: join(stateDirectory, "heartbeats"),
    hookSpoolDirectory: join(stateDirectory, "hook-spool"),
    memoryDirectory: join(stateDirectory, "memory"),
    backupsDirectory: join(stateDirectory, "backups"),
    tmuxSocketName,
    firstMateAdapter,
    claudeExecutable,
    fakeFirstMateEntry,
    reconcileIntervalMs: boundedMilliseconds(
      "PANDAMATE_RECONCILE_INTERVAL_MS",
      500,
      50,
      60_000,
    ),
    heartbeatStaleMs: boundedMilliseconds(
      "PANDAMATE_HEARTBEAT_STALE_MS",
      5_000,
      250,
      300_000,
    ),
    // How long a full shutdown lets each FirstMate take over its own teardown —
    // dismissing a crew and unmounting an Arcadia workspace is minutes of real
    // work — before Pandamate stops what is left.
    shutdownGraceMs: boundedMilliseconds(
      "PANDAMATE_SHUTDOWN_GRACE_MS",
      300_000,
      1_000,
      3_600_000,
    ),
    // How long a redeployed Watcher must stay up before the supervisor treats
    // it as healthy again, and therefore the slowest a broken one can respawn.
    watcherRestartBackoffMs: boundedMilliseconds(
      "PANDAMATE_WATCHER_RESTART_BACKOFF_MS",
      10_000,
      1_000,
      600_000,
    ),
  };
}

export function prepareDirectories(config: PandamateConfig): void {
  mkdirSync(config.stateDirectory, { recursive: true, mode: 0o700 });
  mkdirSync(config.runtimeDirectory, { recursive: true, mode: 0o700 });
  mkdirSync(config.heartbeatDirectory, { recursive: true, mode: 0o700 });
  mkdirSync(config.hookSpoolDirectory, { recursive: true, mode: 0o700 });
  mkdirSync(config.memoryDirectory, { recursive: true, mode: 0o700 });
  mkdirSync(config.backupsDirectory, { recursive: true, mode: 0o700 });
  chmodSync(config.stateDirectory, 0o700);
  chmodSync(config.runtimeDirectory, 0o700);
  chmodSync(config.heartbeatDirectory, 0o700);
  chmodSync(config.hookSpoolDirectory, 0o700);
  chmodSync(config.memoryDirectory, 0o700);
  chmodSync(config.backupsDirectory, 0o700);
}
