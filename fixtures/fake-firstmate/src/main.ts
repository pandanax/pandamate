#!/usr/bin/env node
import process from "node:process";
import { FirstMateClient } from "@pandamate/firstmate-kit";

import {
  FakeFirstMate,
  parseFakeFirstMateOptions,
} from "./index.ts";

const options = parseFakeFirstMateOptions(process.argv.slice(2));
const fixture = new FakeFirstMate(options);
const mailbox = options.socketPath
  ? new FirstMateClient({
      socketPath: options.socketPath,
      projectSlug: options.projectSlug,
      instanceId: `${options.projectSlug}-${process.pid}`,
    })
  : null;
let exiting = false;
let mailboxBusy = false;
const mailboxTimer = mailbox
  ? setInterval(() => {
      if (mailboxBusy) {
        return;
      }
      mailboxBusy = true;
      void mailbox
        .lease({ limit: 10, leaseMilliseconds: 10_000 })
        .then(async (messages) => {
          for (const message of messages) {
            await mailbox.transition(
              message.id,
              "acknowledged",
              "Fake FirstMate accepted the instruction.",
            );
            await mailbox.transition(
              message.id,
              "applied",
              "Fake FirstMate applied the instruction to its deterministic plan.",
            );
            await mailbox.transition(
              message.id,
              "resolved",
              "Fake FirstMate resolved the fixture instruction.",
            );
          }
        })
        .catch(() => {})
        .finally(() => {
          mailboxBusy = false;
        });
    }, 250)
  : null;
mailboxTimer?.unref();

function exit(code: number): void {
  if (exiting) {
    return;
  }
  exiting = true;
  if (mailboxTimer) {
    clearInterval(mailboxTimer);
  }
  fixture.stop();
  process.exitCode = code;
}

process.once("SIGINT", () => exit(0));
process.once("SIGTERM", () => exit(0));
fixture.start(exit);
