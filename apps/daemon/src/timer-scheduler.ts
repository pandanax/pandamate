import type { PandamateStore } from "@pandamate/storage";

export class TimerScheduler {
  readonly #store: Pick<PandamateStore, "fireDueTimers">;
  readonly #intervalMilliseconds: number;
  #timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    store: Pick<PandamateStore, "fireDueTimers">,
    intervalMilliseconds = 500,
  ) {
    this.#store = store;
    this.#intervalMilliseconds = intervalMilliseconds;
  }

  runNow(): number {
    return this.#store.fireDueTimers(100).length;
  }

  start(): void {
    if (this.#timer) {
      return;
    }
    this.runNow();
    this.#timer = setInterval(() => this.runNow(), this.#intervalMilliseconds);
    this.#timer.unref();
  }

  stop(): void {
    if (this.#timer) {
      clearInterval(this.#timer);
      this.#timer = null;
    }
  }
}
