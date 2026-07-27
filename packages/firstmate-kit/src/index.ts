import { randomUUID } from "node:crypto";
import {
  closeSync,
  openSync,
  readSync,
  readFileSync,
  readdirSync,
  mkdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { requestDaemon } from "@pandamate/client";
import type {
  Checkpoint,
  FirstMateStatus,
  Message,
  HookInput,
} from "@pandamate/domain";
import {
  protocolVersion,
  type Request,
  type ResponseData,
} from "@pandamate/protocol";

export interface WorkspaceFirstMateEvidence {
  readonly heartbeatAt: string | null;
  readonly latestStatus: string | null;
  readonly lastAssistantMessage: string | null;
}

function readLastBoundedLine(path: string, size: number): string | null {
  const length = Math.min(size, 8_192);
  if (length === 0) {
    return null;
  }
  const descriptor = openSync(path, "r");
  try {
    const buffer = Buffer.alloc(length);
    readSync(descriptor, buffer, 0, length, Math.max(0, size - length));
    const line = buffer
      .toString("utf8")
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter(Boolean)
      .at(-1);
    return line
      ? line.replaceAll(/[\u0000-\u001f\u007f]/g, " ").slice(0, 240)
      : null;
  } finally {
    closeSync(descriptor);
  }
}

/**
 * A FirstMate that steps into a subdirectory of its own workspace is still
 * that FirstMate. Matching `cwd` exactly froze the Fleet on whatever it said
 * before the first `cd` — for a project whose FirstMate settled into a
 * subtree, that was its opening line, forever. Anything outside the workspace
 * still belongs to somebody else.
 */
function isInsideWorkspace(cwd: unknown, workspace: string): boolean {
  return (
    typeof cwd === "string" &&
    (cwd === workspace || cwd.startsWith(`${workspace}/`))
  );
}

export function firstMateWorkspaceEvidence(
  workspace: string,
  claudeProjectsDirectory = join(homedir(), ".claude", "projects"),
): WorkspaceFirstMateEvidence {
  const canonicalWorkspace =
    workspace.length > 1 ? workspace.replaceAll(/\/+$/g, "") : workspace;
  const stateDirectory = join(canonicalWorkspace, ".firstmate", "state");
  let heartbeatAt: string | null = null;
  try {
    heartbeatAt = statSync(
      join(stateDirectory, ".last-watcher-beat"),
    ).mtime.toISOString();
  } catch {
    // Existing FirstMate evidence is optional.
  }

  let latestStatus: string | null = null;
  try {
    const latest = readdirSync(stateDirectory, { withFileTypes: true })
      .filter(
        (entry) =>
          entry.isFile() &&
          !entry.name.startsWith(".") &&
          entry.name.endsWith(".status"),
      )
      .slice(0, 1_000)
      .map((entry) => {
        const path = join(stateDirectory, entry.name);
        return { path, stat: statSync(path) };
      })
      .sort((left, right) => right.stat.mtimeMs - left.stat.mtimeMs)[0];
    if (latest) {
      latestStatus = readLastBoundedLine(latest.path, latest.stat.size);
    }
  } catch {
    // A missing or concurrently rotated status file is ordinary watcher churn.
  }

  let lastAssistantMessage: string | null = null;
  try {
    const transcriptDirectory = join(
      claudeProjectsDirectory,
      canonicalWorkspace.replaceAll("/", "-"),
    );
    const transcripts = readdirSync(transcriptDirectory, {
      withFileTypes: true,
    })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
      .slice(0, 1_000)
      .map((entry) => {
        const path = join(transcriptDirectory, entry.name);
        return { path, stat: statSync(path) };
      })
      .sort((left, right) => right.stat.mtimeMs - left.stat.mtimeMs);
    for (const transcript of transcripts) {
      const length = Math.min(transcript.stat.size, 2 * 1_024 * 1_024);
      if (length === 0) {
        continue;
      }
      const descriptor = openSync(transcript.path, "r");
      let text: string;
      try {
        const buffer = Buffer.alloc(length);
        readSync(
          descriptor,
          buffer,
          0,
          length,
          Math.max(0, transcript.stat.size - length),
        );
        text = buffer.toString("utf8");
      } finally {
        closeSync(descriptor);
      }
      const lines = text.split(/\r?\n/);
      if (transcript.stat.size > length) {
        lines.shift();
      }
      for (const line of lines.reverse()) {
        if (!line.trim()) {
          continue;
        }
        let entry: unknown;
        try {
          entry = JSON.parse(line);
        } catch {
          continue;
        }
        if (typeof entry !== "object" || entry === null) {
          continue;
        }
        const record = entry as Record<string, unknown>;
        if (
          record.type !== "assistant" ||
          // A worker's reply is not the FirstMate's own word to the captain.
          record.isSidechain === true ||
          !isInsideWorkspace(record.cwd, canonicalWorkspace) ||
          typeof record.message !== "object" ||
          record.message === null
        ) {
          continue;
        }
        const message = record.message as Record<string, unknown>;
        if (message.role !== "assistant" || !Array.isArray(message.content)) {
          continue;
        }
        const assistantText = message.content
          .filter(
            (block): block is Record<string, unknown> =>
              typeof block === "object" &&
              block !== null &&
              (block as Record<string, unknown>).type === "text" &&
              typeof (block as Record<string, unknown>).text === "string",
          )
          .map((block) => block.text as string)
          .join(" ")
          .replaceAll(/\s+/g, " ")
          .trim();
        if (assistantText) {
          lastAssistantMessage = assistantText.slice(0, 240);
          if (
            heartbeatAt === null ||
            transcript.stat.mtimeMs > Date.parse(heartbeatAt)
          ) {
            heartbeatAt = transcript.stat.mtime.toISOString();
          }
          break;
        }
      }
      if (lastAssistantMessage) {
        break;
      }
    }
  } catch {
    // Claude transcripts are optional and may rotate between projection passes.
  }

  return { heartbeatAt, latestStatus, lastAssistantMessage };
}

function requestId(): string {
  return `req_firstmate_${randomUUID()}`;
}

export class HookSpoolClient {
  readonly #socketPath: string;
  readonly #spoolDirectory: string;

  constructor(options: {
    readonly socketPath: string;
    readonly spoolDirectory: string;
  }) {
    if (
      !options.socketPath.startsWith("/") ||
      !options.spoolDirectory.startsWith("/") ||
      options.socketPath.includes("\0") ||
      options.spoolDirectory.includes("\0")
    ) {
      throw new Error("Hook client paths must be absolute");
    }
    this.#socketPath = options.socketPath;
    this.#spoolDirectory = options.spoolDirectory;
    mkdirSync(this.#spoolDirectory, { recursive: true, mode: 0o700 });
  }

  async #deliver(input: HookInput): Promise<void> {
    const response = await requestDaemon(
      this.#socketPath,
      {
        protocol: protocolVersion,
        requestId: requestId(),
        type: "hook.ingest",
        payload: input,
      },
      500,
    );
    if (!response.ok) {
      throw new Error(response.error.message);
    }
  }

  async ingest(input: HookInput): Promise<"delivered" | "spooled"> {
    try {
      await this.#deliver(input);
      return "delivered";
    } catch {
      const name = `${Date.now()}-${randomUUID()}.json`;
      const destination = join(this.#spoolDirectory, name);
      const temporary = `${destination}.${process.pid}.tmp`;
      writeFileSync(temporary, `${JSON.stringify(input)}\n`, {
        encoding: "utf8",
        mode: 0o600,
        flag: "wx",
      });
      renameSync(temporary, destination);
      return "spooled";
    }
  }

  async replay(limit = 100): Promise<number> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
      throw new Error("Invalid hook replay limit");
    }
    const names = readdirSync(this.#spoolDirectory)
      .filter((name) => /^\d+-[a-f0-9-]+\.json$/.test(name))
      .sort()
      .slice(0, limit);
    let delivered = 0;
    for (const name of names) {
      const path = join(this.#spoolDirectory, name);
      const input = JSON.parse(readFileSync(path, "utf8")) as HookInput;
      try {
        await this.#deliver(input);
      } catch {
        break;
      }
      unlinkSync(path);
      delivered += 1;
    }
    return delivered;
  }
}

function value(data: ResponseData): Record<string, unknown> {
  return data as unknown as Record<string, unknown>;
}

export class FirstMateClient {
  readonly #socketPath: string;
  readonly #projectSlug: string;
  readonly #leaseOwner: string;

  constructor(options: {
    readonly socketPath: string;
    readonly projectSlug: string;
    readonly instanceId?: string;
  }) {
    if (!options.socketPath.startsWith("/") || options.socketPath.includes("\0")) {
      throw new Error("FirstMate socket path must be absolute");
    }
    if (!/^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/.test(options.projectSlug)) {
      throw new Error("Invalid FirstMate project slug");
    }
    const instanceId = options.instanceId ?? randomUUID();
    if (!/^[A-Za-z0-9._:-]{1,120}$/.test(instanceId)) {
      throw new Error("Invalid FirstMate instance id");
    }
    this.#socketPath = options.socketPath;
    this.#projectSlug = options.projectSlug;
    this.#leaseOwner = `firstmate:${instanceId}`.slice(0, 120);
  }

  get leaseOwner(): string {
    return this.#leaseOwner;
  }

  async #request(request: Request): Promise<ResponseData> {
    const response = await requestDaemon(this.#socketPath, request, 1_000);
    if (!response.ok) {
      throw new Error(`${response.error.code}: ${response.error.message}`);
    }
    return response.data;
  }

  async lease(
    options: {
      readonly limit?: number;
      readonly leaseMilliseconds?: number;
    } = {},
  ): Promise<readonly Message[]> {
    const data = await this.#request({
      protocol: protocolVersion,
      requestId: requestId(),
      type: "message.lease",
      payload: {
        projectSlug: this.#projectSlug,
        leaseOwner: this.#leaseOwner,
        leaseMilliseconds: options.leaseMilliseconds ?? 60_000,
        limit: options.limit ?? 10,
      },
    });
    const messages = value(data).messages;
    if (!Array.isArray(messages)) {
      throw new Error("Daemon returned invalid leased messages");
    }
    return messages as readonly Message[];
  }

  async transition(
    messageId: string,
    status: "acknowledged" | "applied" | "resolved" | "failed",
    summary: string,
  ): Promise<Message> {
    const data = await this.#request({
      protocol: protocolVersion,
      requestId: requestId(),
      type: "message.transition",
      payload: {
        messageId,
        leaseOwner: this.#leaseOwner,
        status,
        summary,
      },
    });
    const message = value(data).message;
    if (typeof message !== "object" || message === null) {
      throw new Error("Daemon returned an invalid message");
    }
    return message as Message;
  }

  async reportStatus(
    status: Omit<FirstMateStatus, "projectSlug">,
  ): Promise<FirstMateStatus> {
    const data = await this.#request({
      protocol: protocolVersion,
      requestId: requestId(),
      type: "firstmate.status.report",
      payload: { ...status, projectSlug: this.#projectSlug },
    });
    const result = value(data).status;
    if (typeof result !== "object" || result === null) {
      throw new Error("Daemon returned an invalid FirstMate status");
    }
    return result as FirstMateStatus;
  }

  async checkpoint(
    input: Omit<Checkpoint, "id" | "projectId" | "projectSlug" | "createdAt">,
  ): Promise<Checkpoint> {
    const data = await this.#request({
      protocol: protocolVersion,
      requestId: requestId(),
      type: "checkpoint.create",
      payload: { ...input, projectSlug: this.#projectSlug },
    });
    const checkpoint = value(data).checkpoint;
    if (typeof checkpoint !== "object" || checkpoint === null) {
      throw new Error("Daemon returned an invalid checkpoint");
    }
    return checkpoint as Checkpoint;
  }
}
