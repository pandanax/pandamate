import type { PandamateStore } from "@pandamate/storage";

export class MailboxScheduler {
  readonly #store: Pick<PandamateStore, "reconcileMessageRetries">;
  #timer: ReturnType<typeof setInterval> | null = null;

  constructor(store: Pick<PandamateStore, "reconcileMessageRetries">) {
    this.#store = store;
  }

  runNow(): number {
    return this.#store.reconcileMessageRetries(100);
  }

  start(): void {
    if (this.#timer) {
      return;
    }
    this.runNow();
    this.#timer = setInterval(() => this.runNow(), 500);
    this.#timer.unref();
  }

  stop(): void {
    if (this.#timer) {
      clearInterval(this.#timer);
      this.#timer = null;
    }
  }
}
