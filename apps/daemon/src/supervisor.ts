import {
  readFileSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";

import type { PandamateConfig } from "@pandamate/config";
import type { Project } from "@pandamate/domain";
import {
  arcFirstMateHome,
  firstMateWorkspaceEvidence,
  workspaceWatcherCommand,
} from "@pandamate/firstmate-kit";
import {
  closeControlTab,
  deployWatcherWindow,
  discoverTmuxSessions,
  targetForProject,
  type DiscoveredTmuxSession,
  type TmuxClient,
} from "@pandamate/runtime-tmux";
import type { PandamateStore } from "@pandamate/storage";

interface Heartbeat {
  readonly protocolVersion: 1;
  readonly projectSlug: string;
  readonly pid: number;
  readonly state: "running" | "waiting";
  readonly sequence: number;
  readonly timestamp: string;
}

export interface SupervisorLog {
  (
    level: "info" | "error",
    event: string,
    fields?: Readonly<Record<string, unknown>>,
  ): void;
}

type SupervisorTmux = Pick<
  TmuxClient,
  | "run"
  | "resolveSession"
  | "createDetachedInDirectory"
  | "killSession"
  | "renameSession"
  | "setSessionEnvironment"
>;

/**
 * How many times in a row the supervisor deploys a Watcher that does not
 * survive one backoff interval before it stops trying. A Watcher that exits
 * immediately is broken, and respawning it forever would only bury the reason.
 */
const watcherRedeployLimit = 5;

interface WatcherDeployment {
  readonly deploys: number;
  readonly lastDeployedAt: number;
}

export function firstMateProfileForProject(
  project: Pick<Project, "kind">,
): {
  readonly name: "FirstMateArc" | "FirstMateGit" | "DocResearch";
  readonly instructions: string;
  /**
   * Whether this profile raises a supervising FirstMate that owns durable work
   * and dispatches workers (Arc, Git), or a lightweight research partner that
   * only runs a conversational session (DocResearch). It selects the
   * launch-prompt role framing, never any lifecycle: every profile is still the
   * long-running main process for its project.
   */
  readonly supervises: boolean;
} {
  switch (project.kind) {
    case "arc":
      return {
        name: "FirstMateArc",
        instructions:
          "This is an Arcadia workspace. Follow repository AGENTS.md rules, use arc for VCS, and use Arcadia-native code search and ya tooling.",
        supervises: true,
      };
    case "git":
      return {
        name: "FirstMateGit",
        instructions:
          "This is a Git workspace. Inspect its repository instructions before changing files and preserve unrelated user changes.",
        supervises: true,
      };
    case "docs":
      return {
        name: "DocResearch",
        instructions:
          "This is a research and document workspace. Treat source attribution, document fidelity, and durable written results as primary outputs.",
        supervises: false,
      };
  }
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

function parseHeartbeat(path: string, projectSlug: string): Heartbeat | null {
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch (error) {
    if (
      (error as NodeJS.ErrnoException).code === "ENOENT" ||
      error instanceof SyntaxError
    ) {
      return null;
    }
    throw error;
  }
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const heartbeat = value as Record<string, unknown>;
  if (
    heartbeat.protocolVersion !== 1 ||
    heartbeat.projectSlug !== projectSlug ||
    typeof heartbeat.pid !== "number" ||
    !Number.isSafeInteger(heartbeat.pid) ||
    heartbeat.pid <= 0 ||
    (heartbeat.state !== "running" && heartbeat.state !== "waiting") ||
    typeof heartbeat.sequence !== "number" ||
    !Number.isSafeInteger(heartbeat.sequence) ||
    heartbeat.sequence < 1 ||
    typeof heartbeat.timestamp !== "string" ||
    !Number.isFinite(Date.parse(heartbeat.timestamp))
  ) {
    return null;
  }
  return heartbeat as unknown as Heartbeat;
}

export class FirstMateSupervisor {
  readonly #config: PandamateConfig;
  readonly #store: Pick<
    PandamateStore,
    "listProjects" | "recordProjectRuntime"
  >;
  readonly #tmux: SupervisorTmux;
  readonly #log: SupervisorLog;
  readonly #now: () => Date;
  readonly #watchers = new Map<string, WatcherDeployment>();
  #timer: ReturnType<typeof setInterval> | null = null;
  #reconciling = false;
  #draining = false;

  constructor(options: {
    readonly config: PandamateConfig;
    readonly store: Pick<
      PandamateStore,
      "listProjects" | "recordProjectRuntime"
    >;
    readonly tmux: SupervisorTmux;
    readonly log?: SupervisorLog;
    readonly now?: () => Date;
  }) {
    this.#config = options.config;
    this.#store = options.store;
    this.#tmux = options.tmux;
    this.#log = options.log ?? (() => {});
    this.#now = options.now ?? (() => new Date());
  }

  heartbeatPath(slug: string): string {
    return join(this.#config.heartbeatDirectory, `${slug}.json`);
  }

  controlPath(slug: string): string {
    return join(this.#config.heartbeatDirectory, `${slug}.control`);
  }

  launchCommand(project: Project): readonly string[] {
    if (this.#config.firstMateAdapter === "fake") {
      if (!this.#config.fakeFirstMateEntry) {
        throw new Error("Fake FirstMate entry is not configured");
      }
      return [
        process.execPath,
        this.#config.fakeFirstMateEntry,
        "--project",
        project.slug,
        "--heartbeat",
        this.heartbeatPath(project.slug),
        "--control",
        this.controlPath(project.slug),
        "--interval-ms",
        "250",
        "--socket",
        this.#config.socketPath,
      ];
    }
    const profile = firstMateProfileForProject(project);
    const hookEntry = new URL(
      "../../../packages/firstmate-kit/src/hook-cli.ts",
      import.meta.url,
    ).pathname;
    const shellQuote = (value: string): string =>
      `'${value.replaceAll("'", "'\"'\"'")}'`;
    const hookCommand = `${shellQuote(process.execPath)} ${shellQuote(hookEntry)}`;
    const hookSettings = JSON.stringify({
      hooks: Object.fromEntries(
        [
          "SessionStart",
          "PostToolUse",
          "Notification",
          "Stop",
          "SessionEnd",
        ].map((eventName) => [
          eventName,
          [
            {
              matcher: "",
              hooks: [
                {
                  type: "command",
                  command: hookCommand,
                  timeout: 2,
                },
              ],
            },
          ],
        ]),
      ),
    });
    const identity = profile.supervises
      ? `You are running as ${profile.name}, the main FirstMate for project "${project.title}" (${project.slug}).`
      : `You are running as a research partner (${profile.name}) for project "${project.title}" (${project.slug}).`;
    const runtime = profile.supervises
      ? `Your runtime is the Claude Code executable at ${this.#config.claudeExecutable}, launched by Pandamate inside tmux session ${targetForProject(project.slug)}. FirstMate is this long-running main Claude Code process and role; it is not a second hidden executable.`
      : `Your runtime is the Claude Code executable at ${this.#config.claudeExecutable}, launched by Pandamate inside tmux session ${targetForProject(project.slug)}. You are this long-running main Claude Code process for the project — not a second hidden executable, and there is no crew, worktree, or pull-request machinery to run.`;
    const landing =
      project.kind === "git"
        ? project.mergeMode === "auto"
          ? "This project's merge mode is auto: push the isolated branch, open a PR, enable the forge's native auto-merge, and watch required CI. The forge merges after checks pass. Do not push the protected default branch. Do not ask the captain to merge. Merge mode belongs to the project, not to FirstMate."
          : "This project's merge mode is manual: push the isolated branch, open a PR, watch required CI, and wait for the captain to merge. Do not merge or push the protected default branch. Merge mode belongs to the project, not to FirstMate."
        : "For arc, open a PR and watch CI, but never merge or deploy; the captain merges.";
    const role = profile.supervises
      ? `Own this project's detailed work and durable project state. Read the repository instructions and existing project context before acting. Supervise any workers you create, keep their work isolated, report bounded status and checkpoints through the Pandamate integration when available, and remain available between assignments. Any task that changes code runs in its own isolated worktree on its own branch, never edited directly in the shared checkout; isolate such tasks by default and prefer dispatching a worker into that worktree over doing code work in your own session. ${landing}`
      : "Begin by asking the captain focused clarifying questions about the research goal, scope, sources, and the desired deliverable before doing any work. Keep this a lightweight, conversational research session — you are a research partner, not a code-shipping FirstMate. Your product is documents — research notes, a filled wiki, written reports — not pull requests, and you neither dispatch workers nor open worktrees. Capture durable findings as written notes in the workspace.";
    const prompt = `FIRSTMATE_OP: v1
${identity}
Your workspace and working directory are ${project.workspace}.
${runtime}
${profile.instructions}
${role} Never operate on unrelated projects or pandamate:* control-plane sessions.`;
    return [
      "/usr/bin/env",
      `PANDAMATE_PROJECT_SLUG=${project.slug}`,
      `PANDAMATE_TMUX_SESSION=${targetForProject(project.slug)}`,
      `PANDAMATE_SOCKET_PATH=${this.#config.socketPath}`,
      `PANDAMATE_HOOK_SPOOL_DIR=${this.#config.hookSpoolDirectory}`,
      this.#config.claudeExecutable,
      "--settings",
      hookSettings,
      "--permission-mode",
      "auto",
      "--effort",
      "high",
      "--name",
      `${profile.name} ${project.slug}`,
      prompt,
    ];
  }

  start(): void {
    if (this.#timer) {
      return;
    }
    this.reconcileNow();
    this.#timer = setInterval(
      () => this.reconcileNow(),
      this.#config.reconcileIntervalMs,
    );
    this.#timer.unref();
  }

  stop(): void {
    if (this.#timer) {
      clearInterval(this.#timer);
      this.#timer = null;
    }
  }

  get draining(): boolean {
    return this.#draining;
  }

  /**
   * Put the fleet into a shutdown: a draining supervisor keeps watching, but
   * neither launches nor kills. Without it a full graceful shutdown cannot
   * work — the moment a FirstMate closes its own session as the last step of
   * its teardown, an ordinary reconciliation would read the gap as a crash and
   * deploy it all over again. It is deliberately in-memory only, so a daemon
   * restart is always the way back to normal supervision.
   */
  setDraining(draining: boolean): void {
    if (this.#draining === draining) {
      return;
    }
    this.#draining = draining;
    this.#log("info", draining ? "supervisor.draining" : "supervisor.resumed");
  }

  reconcileNow(): void {
    if (this.#reconciling) {
      return;
    }
    this.#reconciling = true;
    try {
      const sessions = discoverTmuxSessions(this.#tmux);
      for (const project of this.#store.listProjects()) {
        try {
          this.#reconcileProject(project, sessions);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          this.#log("error", "supervisor.project.failed", {
            slug: project.slug,
            message,
          });
          this.#store.recordProjectRuntime(project.slug, {
            actualState: "failed",
            tmuxTarget: null,
            tmuxSessionName:
              project.tmuxSessionName ?? targetForProject(project.slug),
            currentSummary: `Runtime reconciliation failed: ${message}`.slice(
              0,
              240,
            ),
            lastHeartbeatAt: project.lastHeartbeatAt,
          });
        }
      }
    } catch (error) {
      this.#log("error", "supervisor.failed", {
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.#reconciling = false;
    }
  }

  /**
   * Best-effort removal of a project's Pandamate home tab before its tmux
   * session is torn down, so stopping, restarting, or recovering a FirstMate
   * never leaves an orphan tab in `pandamate:home`. Failures never block the
   * teardown itself.
   */
  #detachControlTab(sessionName: string): void {
    try {
      closeControlTab(this.#tmux, sessionName);
    } catch (error) {
      this.#log("error", "supervisor.tab.detach_failed", {
        sessionName,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * A project's Watcher is control-plane infrastructure, not something the
   * FirstMate has to remember to start: whenever a project that declares one is
   * running, the supervisor keeps window `watch` of its session up. Deploying
   * it costs no model turn, and a Watcher that dies is put back on the next
   * pass — bounded by a backoff and a redeploy limit so a broken one cannot
   * spin.
   *
   * Only sessions Pandamate named itself are furnished this way. An adopted
   * session belongs to whoever built it.
   */
  #ensureWatcher(project: Project, sessionName: string): void {
    if (
      this.#config.firstMateAdapter !== "claude-code" ||
      sessionName !== targetForProject(project.slug)
    ) {
      return;
    }
    const previous = this.#watchers.get(project.slug);
    const now = this.#now().getTime();
    if (
      previous &&
      (now - previous.lastDeployedAt < this.#config.watcherRestartBackoffMs ||
        previous.deploys >= watcherRedeployLimit)
    ) {
      return;
    }
    try {
      // An arc FirstMate's workspace is product code with no watcher of its
      // own; its watcher lives in the arc crew-tooling home. That home is known
      // without configuration — derived from the workspace's arc root — and an
      // explicit PANDAMATE_FIRSTMATE_HOME overrides the derived path. Git
      // projects resolve from their own workspace and are given no fallback, so
      // a git project without a watcher never inherits the arc one.
      const arcHome =
        project.kind === "arc"
          ? (this.#config.firstMateHome ?? arcFirstMateHome(project.workspace))
          : null;
      const command = workspaceWatcherCommand(
        project.workspace,
        arcHome ? [arcHome] : [],
      );
      if (!command) {
        return;
      }
      const windowId = deployWatcherWindow(
        this.#tmux,
        sessionName,
        project.workspace,
        command,
      );
      if (windowId === null) {
        // It outlived a whole backoff interval, so it is not the broken kind.
        this.#watchers.delete(project.slug);
        return;
      }
      const deploys = (previous?.deploys ?? 0) + 1;
      this.#watchers.set(project.slug, { deploys, lastDeployedAt: now });
      this.#log("info", "supervisor.watcher.deployed", {
        slug: project.slug,
        sessionName,
        windowId,
        command,
        deploys,
      });
      if (deploys >= watcherRedeployLimit) {
        this.#log("error", "supervisor.watcher.abandoned", {
          slug: project.slug,
          sessionName,
          command,
          deploys,
        });
      }
    } catch (error) {
      this.#watchers.set(project.slug, {
        deploys: (previous?.deploys ?? 0) + 1,
        lastDeployedAt: now,
      });
      this.#log("error", "supervisor.watcher.failed", {
        slug: project.slug,
        sessionName,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  #runtimeFor(
    project: Project,
    sessions: readonly DiscoveredTmuxSession[],
  ): DiscoveredTmuxSession | undefined {
    return sessions.find(
      (session) =>
        session.id === project.tmuxTarget ||
        session.name === project.tmuxSessionName,
    );
  }

  /**
   * Draining supervision: record what has already gone, touch nothing else.
   * A FirstMate still holding its session is mid-teardown and must be left to
   * finish, and one whose session is gone is simply closed — which is the only
   * progress signal a graceful fleet shutdown has.
   */
  #observeWhileDraining(
    project: Project,
    runtime: DiscoveredTmuxSession | undefined,
  ): void {
    if (
      runtime ||
      project.actualState === "stopped" ||
      project.actualState === "registered"
    ) {
      return;
    }
    this.#watchers.delete(project.slug);
    this.#store.recordProjectRuntime(project.slug, {
      actualState: "stopped",
      tmuxTarget: null,
      tmuxSessionName:
        project.tmuxSessionName ?? targetForProject(project.slug),
      currentSummary: "Closed during a full Pandamate shutdown",
      lastHeartbeatAt: project.lastHeartbeatAt,
    });
  }

  #reconcileProject(
    project: Project,
    sessions: readonly DiscoveredTmuxSession[],
  ): void {
    let runtime = this.#runtimeFor(project, sessions);
    if (this.#draining) {
      this.#observeWhileDraining(project, runtime);
      return;
    }
    if (project.desiredState === "stopped") {
      if (!runtime && project.actualState === "registered") {
        return;
      }
      if (runtime) {
        this.#detachControlTab(runtime.name);
        this.#tmux.killSession(runtime.name);
        this.#log("info", "supervisor.session.stopped", {
          slug: project.slug,
          sessionName: runtime.name,
        });
      }
      this.#store.recordProjectRuntime(project.slug, {
        actualState: "stopped",
        tmuxTarget: null,
        tmuxSessionName:
          project.tmuxSessionName ?? runtime?.name ?? targetForProject(project.slug),
        currentSummary: "Stopped; retained in Fleet for a future start",
        lastHeartbeatAt: project.lastHeartbeatAt,
      });
      return;
    }

    if (!runtime) {
      const sessionName = targetForProject(project.slug);
      removeIfPresent(this.heartbeatPath(project.slug));
      removeIfPresent(this.controlPath(project.slug));
      this.#store.recordProjectRuntime(project.slug, {
        actualState:
          project.actualState === "starting" ? "starting" : "recovering",
        tmuxTarget: null,
        tmuxSessionName: sessionName,
        currentSummary:
          project.actualState === "starting"
            ? "Launching FirstMate runtime"
            : "Recovering missing FirstMate runtime",
        lastHeartbeatAt: project.lastHeartbeatAt,
      });
      this.#tmux.createDetachedInDirectory(
        sessionName,
        project.workspace,
        this.launchCommand(project),
      );
      this.#log("info", "supervisor.session.started", {
        slug: project.slug,
        sessionName,
        adapter: this.#config.firstMateAdapter,
      });
      // Window 0 gets its environment from the launch argv; every window opened
      // in this session afterwards — the Watcher, a worker the FirstMate
      // dispatches — inherits it from the session instead.
      this.#tmux.setSessionEnvironment(
        sessionName,
        "PANDAMATE_TMUX_SESSION",
        sessionName,
      );
      this.#watchers.delete(project.slug);
      this.#ensureWatcher(project, sessionName);
      return;
    }

    const legacySessionName = `pandamate:${project.slug}`;
    const projectSessionName = targetForProject(project.slug);
    if (runtime.name === legacySessionName) {
      if (sessions.some((session) => session.name === projectSessionName)) {
        throw new Error(
          `Cannot migrate ${legacySessionName}: ${projectSessionName} already exists`,
        );
      }
      this.#tmux.renameSession(runtime.name, projectSessionName);
      this.#log("info", "supervisor.session.migrated", {
        slug: project.slug,
        from: legacySessionName,
        to: projectSessionName,
      });
      runtime = {
        ...runtime,
        name: projectSessionName,
      };
    }

    if (
      project.actualState === "recovering" &&
      project.tmuxTarget === runtime.id &&
      project.currentSummary.startsWith("Restart requested")
    ) {
      this.#detachControlTab(runtime.name);
      this.#tmux.killSession(runtime.name);
      this.#store.recordProjectRuntime(project.slug, {
        actualState: "recovering",
        tmuxTarget: null,
        tmuxSessionName: runtime.name,
        currentSummary: "Prior runtime stopped; launching replacement",
        lastHeartbeatAt: project.lastHeartbeatAt,
      });
      return;
    }

    if (
      this.#config.firstMateAdapter !== "fake" ||
      runtime.name !== targetForProject(project.slug)
    ) {
      this.#ensureWatcher(project, runtime.name);
      const evidence =
        this.#config.firstMateAdapter === "claude-code"
          ? firstMateWorkspaceEvidence(project.workspace)
          : {
              heartbeatAt: null,
              latestStatus: null,
              lastAssistantMessage: null,
            };
      this.#store.recordProjectRuntime(project.slug, {
        actualState: "running",
        tmuxTarget: runtime.id,
        tmuxSessionName: runtime.name,
        currentSummary:
          evidence.lastAssistantMessage ??
          evidence.latestStatus ??
          `${runtime.livePaneCount} live pane${runtime.livePaneCount === 1 ? "" : "s"} in ${runtime.name}`,
        lastHeartbeatAt:
          evidence.heartbeatAt ?? project.lastHeartbeatAt,
      });
      return;
    }

    const heartbeat = parseHeartbeat(
      this.heartbeatPath(project.slug),
      project.slug,
    );
    const heartbeatAge = heartbeat
      ? this.#now().getTime() - Date.parse(heartbeat.timestamp)
      : Number.POSITIVE_INFINITY;
    if (!heartbeat || heartbeatAge > this.#config.heartbeatStaleMs) {
      if (
        project.actualState === "starting" &&
        this.#now().getTime() - Date.parse(project.updatedAt) <=
          this.#config.heartbeatStaleMs
      ) {
        return;
      }
      this.#detachControlTab(runtime.name);
      this.#tmux.killSession(runtime.name);
      this.#store.recordProjectRuntime(project.slug, {
        actualState: "recovering",
        tmuxTarget: null,
        tmuxSessionName: runtime.name,
        currentSummary: "Heartbeat stale; restarting FirstMate",
        lastHeartbeatAt: heartbeat?.timestamp ?? project.lastHeartbeatAt,
      });
      return;
    }
    this.#store.recordProjectRuntime(project.slug, {
      actualState: heartbeat.state,
      tmuxTarget: runtime.id,
      tmuxSessionName: runtime.name,
      currentSummary: `Fake FirstMate ${heartbeat.state}; heartbeat ${heartbeat.sequence}`,
      lastHeartbeatAt: heartbeat.timestamp,
    });
  }
}
