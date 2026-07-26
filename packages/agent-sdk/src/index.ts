import {
  query as claudeQuery,
  type Options,
  type Query,
  type SDKMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type {
  Decision,
  EventRecord,
  Message,
  Project,
} from "@pandamate/domain";

export interface BrainBriefingInput {
  readonly projects: readonly Project[];
  readonly decisions: readonly Decision[];
  readonly messages: readonly Message[];
  readonly events: readonly EventRecord[];
}

export function buildBrainBriefing(
  input: BrainBriefingInput,
  maximumCharacters = 12_000,
): string {
  if (
    !Number.isSafeInteger(maximumCharacters) ||
    maximumCharacters < 1_000 ||
    maximumCharacters > 100_000
  ) {
    throw new Error("Invalid brain briefing budget");
  }
  const payload = {
    projects: input.projects.slice(0, 100).map((project) => ({
      slug: project.slug,
      title: project.title,
      kind: project.kind,
      desiredState: project.desiredState,
      actualState: project.actualState,
      summary: project.currentSummary,
      attention: project.attentionLevel,
    })),
    decisions: input.decisions
      .filter((decision) => decision.status === "active")
      .slice(0, 100)
      .map((decision) => ({
        topic: decision.topic,
        value: decision.value.slice(0, 1_000),
        summary: decision.summary,
      })),
    unresolvedMessages: input.messages
      .filter(
        (message) =>
          message.status !== "resolved" &&
          message.status !== "dead-letter",
      )
      .slice(0, 50)
      .map((message) => ({
        id: message.id,
        project: message.projectSlug,
        priority: message.priority,
        status: message.status,
        text: message.text.slice(0, 1_000),
      })),
    recentEvents: input.events.slice(-100).map((event) => ({
      sequence: event.sequence,
      type: event.type,
      projectId: event.projectId,
      recordedAt: event.recordedAt,
    })),
  };
  const encoded = JSON.stringify(payload);
  if (encoded.length <= maximumCharacters) {
    return encoded;
  }
  return `${encoded.slice(0, maximumCharacters - 80)},"truncated":true}`;
}

export function routeProject(
  text: string,
  projects: readonly Pick<Project, "slug" | "title">[],
): { readonly slug: string; readonly confidence: "exact" | "unique" } | null {
  const normalized = text.toLocaleLowerCase();
  const exact = projects.find(
    (project) =>
      normalized.includes(project.slug.toLocaleLowerCase()) ||
      normalized.includes(project.title.toLocaleLowerCase()),
  );
  if (exact) {
    return { slug: exact.slug, confidence: "exact" };
  }
  const words = new Set(normalized.split(/[^\p{L}\p{N}]+/u).filter(Boolean));
  const candidates = projects.filter((project) =>
    project.title
      .toLocaleLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .some((word) => word.length >= 3 && words.has(word)),
  );
  return candidates.length === 1
    ? { slug: candidates[0]!.slug, confidence: "unique" }
    : null;
}

interface BrainQuery extends AsyncIterable<SDKMessage> {
  close(): void;
}

export interface BrainChunk {
  readonly type: "session" | "text" | "result" | "error";
  readonly text: string;
  readonly sessionId: string | null;
}

export class PandamateBrain {
  readonly #cwd: string;
  readonly #claudeExecutable: string;
  readonly #model: string | undefined;
  readonly #query: (input: {
    prompt: string;
    options: Options;
  }) => BrainQuery;
  readonly #rotateAfterTurns: number;
  #sessionId: string | null = null;
  #turns = 0;
  #active: BrainQuery | null = null;

  constructor(options: {
    readonly cwd: string;
    readonly claudeExecutable: string;
    readonly model?: string;
    readonly rotateAfterTurns?: number;
    readonly queryFactory?: (input: {
      prompt: string;
      options: Options;
    }) => BrainQuery;
  }) {
    this.#cwd = options.cwd;
    this.#claudeExecutable = options.claudeExecutable;
    this.#model = options.model;
    this.#rotateAfterTurns = options.rotateAfterTurns ?? 20;
    this.#query =
      options.queryFactory ??
      ((input) => claudeQuery(input) as Query);
  }

  get sessionId(): string | null {
    return this.#sessionId;
  }

  cancel(): void {
    this.#active?.close();
    this.#active = null;
  }

  async *ask(
    question: string,
    briefing: string,
    signal?: AbortSignal,
  ): AsyncGenerator<BrainChunk> {
    if (
      question.trim().length === 0 ||
      question.length > 8_192 ||
      briefing.length > 100_000
    ) {
      throw new Error("Invalid brain request");
    }
    if (this.#turns >= this.#rotateAfterTurns) {
      this.#sessionId = null;
      this.#turns = 0;
    }
    const controller = new AbortController();
    const deadline = setTimeout(() => {
      controller.abort();
      this.cancel();
    }, 45_000);
    deadline.unref();
    const abort = () => {
      controller.abort();
      this.cancel();
    };
    signal?.addEventListener("abort", abort, { once: true });
    const options: Options = {
      cwd: this.#cwd,
      pathToClaudeCodeExecutable: this.#claudeExecutable,
      ...(this.#model ? { model: this.#model } : {}),
      ...(this.#sessionId ? { resume: this.#sessionId } : {}),
      abortController: controller,
      tools: [],
      permissionMode: "dontAsk",
      maxTurns: 1,
      maxBudgetUsd: 0.25,
      includePartialMessages: true,
      persistSession: true,
      env: {
        ...process.env,
        CLAUDE_AGENT_SDK_CLIENT_APP: "pandamate/0.1",
      },
    };
    const prompt = `You are the Pandamate control-plane brain. Answer from the bounded durable briefing below. Do not claim to execute lifecycle or persistence actions; you have no tools. If a project target is ambiguous, ask one concise clarification.

BRIEFING:
${briefing}

PANDA:
${question}`;
    const stream = this.#query({ prompt, options });
    this.#active = stream;
    try {
      for await (const message of stream) {
        if ("session_id" in message && typeof message.session_id === "string") {
          this.#sessionId = message.session_id;
        }
        if (
          message.type === "system" &&
          message.subtype === "api_retry" &&
          (message.error_status === 401 || message.error_status === 403)
        ) {
          stream.close();
          yield {
            type: "error",
            text:
              message.error_status === 401
                ? "Claude Code is not authenticated. Run `claude auth` and try again."
                : "Claude Code authentication does not permit this request.",
            sessionId: this.#sessionId,
          };
          return;
        } else if (message.type === "system" && message.subtype === "init") {
          yield {
            type: "session",
            text: `Claude ${message.claude_code_version} · ${message.model}`,
            sessionId: this.#sessionId,
          };
        } else if (
          message.type === "stream_event" &&
          message.event.type === "content_block_delta" &&
          message.event.delta.type === "text_delta"
        ) {
          yield {
            type: "text",
            text: message.event.delta.text,
            sessionId: this.#sessionId,
          };
        } else if (message.type === "result") {
          this.#turns += 1;
          yield {
            type: message.subtype === "success" ? "result" : "error",
            text:
              message.subtype === "success"
                ? message.result
                : message.errors.join("; "),
            sessionId: this.#sessionId,
          };
        }
      }
    } finally {
      clearTimeout(deadline);
      signal?.removeEventListener("abort", abort);
      if (this.#active === stream) {
        this.#active = null;
      }
    }
  }
}
