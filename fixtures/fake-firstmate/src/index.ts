import {
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";

export interface FakeFirstMateOptions {
  readonly projectSlug: string;
  readonly heartbeatPath: string;
  readonly controlPath: string;
  readonly intervalMs: number;
  readonly socketPath?: string;
}

export interface FakeFirstMateHeartbeat {
  readonly protocolVersion: 1;
  readonly projectSlug: string;
  readonly pid: number;
  readonly state: "running" | "waiting";
  readonly sequence: number;
  readonly timestamp: string;
}

export function parseFakeFirstMateOptions(
  args: readonly string[],
): FakeFirstMateOptions {
  const option = (name: string): string => {
    const index = args.indexOf(name);
    const value = index === -1 ? undefined : args[index + 1];
    if (!value) {
      throw new Error(`Missing ${name}`);
    }
    return value;
  };
  const projectSlug = option("--project");
  if (!/^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/.test(projectSlug)) {
    throw new Error("Invalid fake FirstMate project slug");
  }
  const heartbeatPath = option("--heartbeat");
  const controlPath = option("--control");
  if (
    !heartbeatPath.startsWith("/") ||
    !controlPath.startsWith("/") ||
    heartbeatPath.includes("\0") ||
    controlPath.includes("\0")
  ) {
    throw new Error("Fake FirstMate paths must be absolute");
  }
  const intervalMs = Number(option("--interval-ms"));
  if (
    !Number.isSafeInteger(intervalMs) ||
    intervalMs < 50 ||
    intervalMs > 60_000
  ) {
    throw new Error("Invalid fake FirstMate heartbeat interval");
  }
  const socketIndex = args.indexOf("--socket");
  const socketPath = socketIndex === -1 ? undefined : args[socketIndex + 1];
  if (
    socketPath !== undefined &&
    (!socketPath.startsWith("/") || socketPath.includes("\0"))
  ) {
    throw new Error("Invalid fake FirstMate socket path");
  }
  return {
    projectSlug,
    heartbeatPath,
    controlPath,
    intervalMs,
    ...(socketPath ? { socketPath } : {}),
  };
}

function removeIfPresent(path: string): void {
  try {
    unlinkSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
}

export class FakeFirstMate {
  readonly #options: FakeFirstMateOptions;
  #state: "running" | "waiting" = "running";
  #sequence = 0;
  #timer: ReturnType<typeof setInterval> | null = null;
  #lastControl = "";

  constructor(options: FakeFirstMateOptions) {
    this.#options = options;
  }

  heartbeat(now = new Date()): FakeFirstMateHeartbeat {
    this.#sequence += 1;
    const heartbeat: FakeFirstMateHeartbeat = {
      protocolVersion: 1,
      projectSlug: this.#options.projectSlug,
      pid: process.pid,
      state: this.#state,
      sequence: this.#sequence,
      timestamp: now.toISOString(),
    };
    const temporaryPath = `${this.#options.heartbeatPath}.${process.pid}.tmp`;
    writeFileSync(temporaryPath, `${JSON.stringify(heartbeat)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    renameSync(temporaryPath, this.#options.heartbeatPath);
    return heartbeat;
  }

  applyControl(): "continue" | "exit" {
    let command = "";
    try {
      command = readFileSync(this.#options.controlPath, "utf8").trim();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
      return "continue";
    }
    if (command === "" || command === this.#lastControl) {
      return "continue";
    }
    this.#lastControl = command;
    switch (command) {
      case "pause":
        this.#state = "waiting";
        return "continue";
      case "resume":
        this.#state = "running";
        return "continue";
      case "exit":
        return "exit";
      case "crash":
        throw new Error("Injected fake FirstMate crash");
      default:
        throw new Error(`Unknown fake FirstMate control: ${command}`);
    }
  }

  tick(now = new Date()): "continue" | "exit" {
    const disposition = this.applyControl();
    if (disposition === "continue") {
      this.heartbeat(now);
    }
    return disposition;
  }

  start(onExit: (code: number) => void): void {
    if (this.#timer) {
      throw new Error("Fake FirstMate already started");
    }
    removeIfPresent(this.#options.heartbeatPath);
    let finished = false;
    const finish = (code: number) => {
      if (finished) {
        return;
      }
      finished = true;
      this.stop();
      onExit(code);
    };
    const run = () => {
      try {
        if (this.tick() === "exit") {
          finish(0);
        }
      } catch {
        finish(42);
      }
    };
    run();
    if (!finished) {
      this.#timer = setInterval(run, this.#options.intervalMs);
    }
  }

  stop(): void {
    if (this.#timer) {
      clearInterval(this.#timer);
      this.#timer = null;
    }
  }
}
