import { loadConfig, prepareDirectories } from "@pandamate/config";
import { TmuxClient } from "@pandamate/runtime-tmux";
import { PandamateStore } from "@pandamate/storage";

import { acquireInstanceLock } from "./lock.ts";
import { startServer } from "./server.ts";
import { FirstMateSupervisor } from "./supervisor.ts";
import { TimerScheduler } from "./timer-scheduler.ts";
import { MailboxScheduler } from "./mailbox-scheduler.ts";
import { HookSpoolClient } from "@pandamate/firstmate-kit";
import { HookSpoolReplayer } from "./hook-spool-replayer.ts";

const config = loadConfig();
prepareDirectories(config);
const lock = acquireInstanceLock(config.lockPath);
const store = new PandamateStore(config.databasePath);
const tmux = new TmuxClient(
  config.tmuxSocketName ? { socketName: config.tmuxSocketName } : {},
);
let server: Awaited<ReturnType<typeof startServer>> | undefined;
const supervisor = new FirstMateSupervisor({
  config,
  store,
  tmux,
});
const timerScheduler = new TimerScheduler(store);
const mailboxScheduler = new MailboxScheduler(store);
const hookSpoolReplayer = new HookSpoolReplayer(
  new HookSpoolClient({
    socketPath: config.socketPath,
    spoolDirectory: config.hookSpoolDirectory,
  }),
);
let stopping = false;

async function stop(exitCode = 0): Promise<void> {
  if (stopping) {
    return;
  }
  stopping = true;
  try {
    await server?.close();
    supervisor.stop();
    timerScheduler.stop();
    mailboxScheduler.stop();
    hookSpoolReplayer.stop();
    store.close();
    lock.release();
    process.exitCode = exitCode;
  } catch (error) {
    process.stderr.write(
      `Failed to stop Pandamate daemon: ${
        error instanceof Error ? error.message : String(error)
      }\n`,
    );
    process.exitCode = 1;
  }
}

process.once("SIGINT", () => void stop());
process.once("SIGTERM", () => void stop());

try {
  server = await startServer(config, store, () => void stop(), tmux);
  supervisor.start();
  timerScheduler.start();
  mailboxScheduler.start();
  hookSpoolReplayer.start();
  process.stdout.write(`pandamated listening on ${config.socketPath}\n`);
} catch (error) {
  store.close();
  lock.release();
  throw error;
}
