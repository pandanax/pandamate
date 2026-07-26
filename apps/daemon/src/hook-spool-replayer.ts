import { HookSpoolClient } from "@pandamate/firstmate-kit";

export class HookSpoolReplayer {
  readonly #client: HookSpoolClient;
  #timer: ReturnType<typeof setInterval> | null = null;
  #running = false;

  constructor(client: HookSpoolClient) {
    this.#client = client;
  }

  async runNow(): Promise<number> {
    if (this.#running) {
      return 0;
    }
    this.#running = true;
    try {
      return await this.#client.replay(100);
    } catch {
      return 0;
    } finally {
      this.#running = false;
    }
  }

  start(): void {
    if (this.#timer) {
      return;
    }
    void this.runNow();
    this.#timer = setInterval(() => void this.runNow(), 1_000);
    this.#timer.unref();
  }

  stop(): void {
    if (this.#timer) {
      clearInterval(this.#timer);
      this.#timer = null;
    }
  }
}
