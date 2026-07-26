import {
  closeSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";

export interface InstanceLock {
  readonly release: () => void;
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === "EPERM";
  }
}

export function acquireInstanceLock(lockPath: string): InstanceLock {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const descriptor = openSync(lockPath, "wx", 0o600);
      writeFileSync(descriptor, `${process.pid}\n`, "utf8");
      let released = false;
      return {
        release: () => {
          if (released) {
            return;
          }
          released = true;
          closeSync(descriptor);
          try {
            unlinkSync(lockPath);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
              throw error;
            }
          }
        },
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }
      const stored = readFileSync(lockPath, "utf8").trim();
      const pid = Number(stored);
      if (Number.isSafeInteger(pid) && pid > 0 && processExists(pid)) {
        throw new Error(`Pandamate daemon is already running with PID ${pid}`);
      }
      unlinkSync(lockPath);
    }
  }
  throw new Error("Unable to acquire Pandamate daemon lock");
}
