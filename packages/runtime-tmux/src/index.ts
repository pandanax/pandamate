import { execFileSync } from "node:child_process";
import { isAbsolute, normalize } from "node:path";

const slugPattern = /^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/;
const stablePaneIdPattern = /^\$\d+:@\d+\.%\d+$/;
const stableSessionIdPattern = /^\$\d+$/;
const stableWindowIdPattern = /^@\d+$/;
const clientTtyPattern = /^\/dev\/(?:ttys?[a-zA-Z0-9]+|pts\/\d+)$/;
const socketNamePattern = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;

/**
 * tmux pushes `-F` output through its UTF-8 sanitiser, which rewrites every
 * non-printable byte — a literal tab included — as `_` whenever the tmux client
 * runs without a UTF-8 ctype. The daemon is started from the macOS app bundle,
 * whose environment carries no LANG/LC_*, so tab-separated formats collapsed
 * into a single field there: every `resolveSession` became "Unknown tmux
 * session" and reconciliation stopped. Formats therefore use a printable
 * delimiter, and the one free-form field per row (session name, pane path)
 * always comes last so it may contain the delimiter itself.
 */
const fieldSeparator = "|";

function splitRow(row: string, fieldCount: number): readonly string[] | null {
  const fields: string[] = [];
  let rest = row;
  for (let index = 0; index < fieldCount - 1; index += 1) {
    const boundary = rest.indexOf(fieldSeparator);
    if (boundary === -1) {
      return null;
    }
    fields.push(rest.slice(0, boundary));
    rest = rest.slice(boundary + fieldSeparator.length);
  }
  fields.push(rest);
  return fields;
}

export interface CommandRunner {
  run(executable: string, args: readonly string[]): string;
}

export class SynchronousCommandRunner implements CommandRunner {
  run(executable: string, args: readonly string[]): string {
    // Keep tmux in UTF-8 mode so it never sanitises non-ASCII session names or
    // pane paths on the way out. LC_ALL would override LC_CTYPE, so it is
    // dropped instead of trusted.
    const environment: NodeJS.ProcessEnv = {
      ...process.env,
      LC_CTYPE: "UTF-8",
    };
    delete environment.LC_ALL;
    return execFileSync(executable, [...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: environment,
    }).trim();
  }
}

export function validateProjectSlug(slug: string): string {
  if (!slugPattern.test(slug)) {
    throw new Error(
      "Project slug must be 1-48 lowercase ASCII letters, digits, or hyphens",
    );
  }
  if (
    slug === "home" ||
    slug === "write" ||
    slug === "idle-probe" ||
    slug === "probe-keeper" ||
    slug.startsWith("control-") ||
    slug.startsWith("service-")
  ) {
    throw new Error("Project slug is reserved for a Pandamate service");
  }
  return slug;
}

export function targetForProject(slug: string): string {
  return `firstmate-${validateProjectSlug(slug)}`;
}

export function targetForPandamateService(serviceName: string): string {
  if (
    serviceName !== "home" &&
    serviceName !== "write" &&
    serviceName !== "idle-probe" &&
    serviceName !== "probe-keeper" &&
    !/^service-[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/.test(serviceName)
  ) {
    throw new Error("Invalid Pandamate service name");
  }
  return `pandamate:${serviceName}`;
}

export function isPandamateControlSession(sessionName: string): boolean {
  return (
    sessionName === "pandamate:home" ||
    sessionName === "pandamate:write" ||
    sessionName === "pandamate:idle-probe" ||
    sessionName === "pandamate:probe-keeper" ||
    sessionName.startsWith("pandamate:control-") ||
    sessionName.startsWith("pandamate:service-")
  );
}

export function validateStablePaneId(target: string): string {
  if (!stablePaneIdPattern.test(target)) {
    throw new Error(`Invalid stable tmux pane id: ${target}`);
  }
  return target;
}

export function validateStableSessionId(target: string): string {
  if (!stableSessionIdPattern.test(target)) {
    throw new Error(`Invalid stable tmux session id: ${target}`);
  }
  return target;
}

export function validateStableWindowId(target: string): string {
  if (!stableWindowIdPattern.test(target)) {
    throw new Error(`Invalid stable tmux window id: ${target}`);
  }
  return target;
}

export function validateClientTty(clientTty: string): string {
  if (!clientTtyPattern.test(clientTty)) {
    throw new Error(`Invalid tmux client tty: ${clientTty}`);
  }
  return clientTty;
}

export function validateSocketName(socketName: string): string {
  if (!socketNamePattern.test(socketName)) {
    throw new Error(`Invalid tmux socket name: ${socketName}`);
  }
  return socketName;
}

export interface TmuxClientOptions {
  readonly socketName?: string;
  readonly runner?: CommandRunner;
}

export interface AttachedClient {
  readonly tty: string;
  readonly sessionName: string;
  readonly paneId: string;
}

export class TmuxClient {
  readonly #prefix: readonly string[];
  readonly #runner: CommandRunner;

  constructor(options: TmuxClientOptions = {}) {
    this.#prefix = options.socketName
      ? ["-L", validateSocketName(options.socketName)]
      : [];
    this.#runner = options.runner ?? new SynchronousCommandRunner();
  }

  run(args: readonly string[]): string {
    return this.#runner.run("tmux", [...this.#prefix, ...args]).trim();
  }

  version(): string {
    return this.run(["-V"]);
  }

  hasSession(target: string): boolean {
    return this.listSessions().includes(target);
  }

  createDetached(target: string, command: readonly string[]): void {
    if (command.length === 0 || command.some((argument) => argument.includes("\0"))) {
      throw new Error("Detached tmux command must contain safe argv entries");
    }
    this.run(["new-session", "-d", "-s", target, ...command]);
  }

  createDetachedInDirectory(
    target: string,
    workingDirectory: string,
    command: readonly string[],
  ): void {
    if (
      !isAbsolute(workingDirectory) ||
      normalize(workingDirectory) !== workingDirectory ||
      workingDirectory.includes("\0")
    ) {
      throw new Error("Detached tmux working directory must be canonical");
    }
    if (command.length === 0 || command.some((argument) => argument.includes("\0"))) {
      throw new Error("Detached tmux command must contain safe argv entries");
    }
    this.run([
      "new-session",
      "-d",
      "-s",
      target,
      "-c",
      workingDirectory,
      ...command,
    ]);
  }

  killSession(target: string): void {
    this.run(["kill-session", "-t", this.resolveSession(target)]);
  }

  renameSession(target: string, newName: string): void {
    if (!newName.startsWith("firstmate-")) {
      throw new Error("Project tmux session must use the firstmate- namespace");
    }
    validateProjectSlug(newName.slice("firstmate-".length));
    this.run([
      "rename-session",
      "-t",
      this.resolveSession(target),
      newName,
    ]);
  }

  listSessions(): readonly string[] {
    const output = this.run(["list-sessions", "-F", "#{session_name}"]);
    return output === "" ? [] : output.split("\n");
  }

  resolveSession(sessionName: string): string {
    const rows = this.run([
      "list-sessions",
      "-F",
      `#{session_id}${fieldSeparator}#{session_name}`,
    ]);
    if (rows !== "") {
      for (const row of rows.split("\n")) {
        const fields = splitRow(row, 2);
        if (!fields) {
          throw new Error(`Malformed tmux session row: ${row}`);
        }
        const [sessionId, name] = fields;
        if (name === sessionName && sessionId) {
          return validateStableSessionId(sessionId);
        }
      }
    }
    throw new Error(`Unknown tmux session: ${sessionName}`);
  }

  listClients(): readonly AttachedClient[] {
    const output = this.run([
      "list-clients",
      "-F",
      `#{client_tty}${fieldSeparator}#{session_id}:#{window_id}.#{pane_id}${fieldSeparator}#{session_name}`,
    ]);
    if (output === "") {
      return [];
    }
    return output.split("\n").map((line) => {
      const fields = splitRow(line, 3) ?? [];
      const [tty, paneId, sessionName] = fields;
      if (!tty || !sessionName || !paneId) {
        throw new Error(`Malformed tmux client row: ${line}`);
      }
      return {
        tty: validateClientTty(tty),
        sessionName,
        paneId: validateStablePaneId(paneId),
      };
    });
  }

  switchClient(clientTty: string, destination: string): void {
    validateClientTty(clientTty);
    const resolvedDestination = destination.startsWith("$")
      ? destination
      : this.resolveSession(destination);
    if (resolvedDestination.includes(":")) {
      validateStablePaneId(resolvedDestination);
    } else {
      validateStableSessionId(resolvedDestination);
    }
    this.run([
      "switch-client",
      "-c",
      clientTty,
      "-t",
      resolvedDestination,
    ]);
  }

  capturePane(target: string): string {
    return this.run(["capture-pane", "-p", "-t", this.resolveSession(target)]);
  }

  activePaneInWindowZero(target: string): string {
    const sessionId = this.resolveSession(target);
    const pane = this.run([
      "list-panes",
      "-t",
      `${sessionId}:0`,
      "-f",
      "#{pane_active}",
      "-F",
      "#{session_id}:#{window_id}.#{pane_id}",
    ]);
    if (pane.includes("\n")) {
      throw new Error(`Window 0 has multiple active panes: ${target}`);
    }
    return validateStablePaneId(pane);
  }

  sendTextAndEnter(target: string, text: string): void {
    if (text.length === 0 || text.length > 4000 || text.includes("\0")) {
      throw new Error("Unsafe tmux message");
    }
    validateStablePaneId(target);
    this.run(["send-keys", "-t", target, "-l", text]);
    this.run(["send-keys", "-t", target, "Enter"]);
  }

  resizeWindow(target: string, width: number, height: number): void {
    if (
      !Number.isInteger(width) ||
      !Number.isInteger(height) ||
      width < 20 ||
      height < 10
    ) {
      throw new Error(`Invalid tmux size: ${width}x${height}`);
    }
    this.run([
      "resize-window",
      "-t",
      this.resolveSession(target),
      "-x",
      String(width),
      "-y",
      String(height),
    ]);
  }

  sendLiteralKey(target: string, key: string): void {
    if (!/^[a-z]$/.test(key)) {
      throw new Error(`Unsafe fixture key: ${key}`);
    }
    this.run(["send-keys", "-t", this.resolveSession(target), "-l", key]);
  }

  setGlobalEnvironment(name: string, value: string): void {
    if (!/^PANDAMATE_[A-Z0-9_]+$/.test(name)) {
      throw new Error(`Unsafe fixture environment name: ${name}`);
    }
    this.run(["set-environment", "-g", name, value]);
  }

  panePid(target: string): number {
    const value = this.run([
      "display-message",
      "-p",
      "-t",
      this.resolveSession(target),
      "#{pane_pid}",
    ]);
    const pid = Number(value);
    if (!Number.isSafeInteger(pid) || pid <= 0) {
      throw new Error(`Invalid pane pid: ${value}`);
    }
    return pid;
  }
}

export interface DiscoveredTmuxSession {
  readonly id: string;
  readonly name: string;
  readonly attachedClients: number;
  readonly windowCount: number;
  readonly livePaneCount: number;
  readonly commands: readonly string[];
  readonly paths: readonly string[];
}

interface MutableSession {
  id: string;
  name: string;
  attachedClients: number;
  windowCount: number;
  livePaneCount: number;
  commands: Set<string>;
  paths: Set<string>;
}

function parseNonNegativeInteger(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
  return parsed;
}

export function discoverTmuxSessions(
  tmux: Pick<TmuxClient, "run">,
): readonly DiscoveredTmuxSession[] {
  const sessions = new Map<string, MutableSession>();
  const sessionRows = tmux.run([
    "list-sessions",
    "-F",
    `#{session_id}${fieldSeparator}#{session_attached}${fieldSeparator}#{session_windows}${fieldSeparator}#{session_name}`,
  ]);
  for (const row of sessionRows.split("\n")) {
    const [id, attached, windows, name] = splitRow(row, 4) ?? [];
    if (!id || !name || attached === undefined || windows === undefined) {
      throw new Error(`Malformed tmux session row: ${row}`);
    }
    sessions.set(validateStableSessionId(id), {
      id,
      name,
      attachedClients: parseNonNegativeInteger(attached, "attached clients"),
      windowCount: parseNonNegativeInteger(windows, "window count"),
      livePaneCount: 0,
      commands: new Set<string>(),
      paths: new Set<string>(),
    });
  }

  const paneRows = tmux.run([
    "list-panes",
    "-a",
    "-F",
    `#{session_id}${fieldSeparator}#{pane_dead}${fieldSeparator}#{pane_current_command}${fieldSeparator}#{pane_current_path}`,
  ]);
  for (const row of paneRows.split("\n")) {
    const [sessionId, dead, command, path] = splitRow(row, 4) ?? [];
    if (!sessionId || dead === undefined || !command || path === undefined) {
      throw new Error(`Malformed tmux pane row: ${row}`);
    }
    const session = sessions.get(sessionId);
    if (!session) {
      throw new Error(`Pane references unknown tmux session: ${sessionId}`);
    }
    if (dead === "0") {
      session.livePaneCount += 1;
    } else if (dead !== "1") {
      throw new Error(`Invalid pane_dead value: ${dead}`);
    }
    session.commands.add(command);
    if (path !== "") {
      session.paths.add(path);
    }
  }

  return [...sessions.values()]
    .map((session) => ({
      id: session.id,
      name: session.name,
      attachedClients: session.attachedClients,
      windowCount: session.windowCount,
      livePaneCount: session.livePaneCount,
      commands: [...session.commands].sort(),
      paths: [...session.paths].sort(),
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function validateExecutablePath(executable: string): string {
  if (!/^\/[A-Za-z0-9._+/-]+$/.test(executable)) {
    throw new Error(`Invalid executable path: ${executable}`);
  }
  return executable;
}

export function attachCommandForSessionId(
  sessionId: string,
  tmuxExecutable: string,
): string {
  validateStableSessionId(sessionId);
  return `${validateExecutablePath(tmuxExecutable)} attach-session -t '${sessionId}'`;
}

export function openSessionInNewITermWindow(
  tmux: Pick<TmuxClient, "resolveSession">,
  sessionName: string,
  runner: CommandRunner = new SynchronousCommandRunner(),
): string {
  const sessionId = tmux.resolveSession(sessionName);
  const tmuxExecutable = validateExecutablePath(
    runner.run("/usr/bin/which", ["tmux"]),
  );
  const attachCommand = attachCommandForSessionId(
    sessionId,
    tmuxExecutable,
  );
  runner.run("osascript", [
    "-e",
    'tell application "iTerm"',
    "-e",
    "activate",
    "-e",
    `set firstMateWindow to (create window with default profile command "${attachCommand}")`,
    "-e",
    "end tell",
  ]);
  return sessionId;
}

interface ControlWindow {
  readonly index: number;
  readonly id: string;
  readonly name: string;
}

function listControlWindows(
  tmux: Pick<TmuxClient, "run">,
  controlSessionId: string,
): readonly ControlWindow[] {
  const rows = tmux.run([
    "list-windows",
    "-t",
    controlSessionId,
    "-F",
    `#{window_index}${fieldSeparator}#{window_id}${fieldSeparator}#{window_name}`,
  ]);
  if (rows === "") {
    return [];
  }
  return rows.split("\n").map((row) => {
    const [index, id, name] = splitRow(row, 3) ?? [];
    if (index === undefined || id === undefined || !name) {
      throw new Error(`Malformed tmux window row: ${row}`);
    }
    const parsedIndex = Number(index);
    if (!Number.isSafeInteger(parsedIndex) || parsedIndex < 0) {
      throw new Error(`Invalid tmux window index: ${index}`);
    }
    return { index: parsedIndex, id: validateStableWindowId(id), name };
  });
}

export interface ControlTab {
  readonly index: number;
  readonly name: string;
}

/**
 * Which Pandamate home tab a FirstMate currently occupies, so the UI can name
 * the tab the user should switch to instead of vaguely claiming a window was
 * opened. Null when home is not running, the project session is gone, or the
 * project has no tab.
 */
export function controlTabForSession(
  tmux: Pick<TmuxClient, "run" | "resolveSession">,
  sessionName: string,
): ControlTab | null {
  let controlSessionId: string;
  let projectWindowId: string;
  try {
    controlSessionId = tmux.resolveSession(targetForPandamateService("home"));
    projectWindowId = validateStableWindowId(
      tmux.run([
        "display-message",
        "-p",
        "-t",
        `${tmux.resolveSession(sessionName)}:0`,
        "#{window_id}",
      ]),
    );
  } catch {
    return null;
  }
  const tab = listControlWindows(tmux, controlSessionId).find(
    (window) => window.id === projectWindowId,
  );
  return tab ? { index: tab.index, name: tab.name } : null;
}

/**
 * Open a FirstMate project session as a tab inside the attached Pandamate home
 * session instead of spawning a separate terminal window. Window 0 of the
 * project session is linked into `pandamate:home`, so the FirstMate keeps
 * running in its own durable session while also appearing as a tmux tab the
 * user switches to with the tmux prefix. Idempotent: a project already linked
 * as a tab is just selected again.
 *
 * All targets use stable session ids (`$N`) so the colon in the control
 * session name (`pandamate:home`) never collides with tmux `session:window`
 * target parsing.
 */
export function openSessionAsControlTab(
  tmux: Pick<TmuxClient, "run" | "resolveSession">,
  sessionName: string,
): string {
  if (isPandamateControlSession(sessionName)) {
    throw new Error("Cannot open a Pandamate control session as a tab");
  }
  if (!sessionName.startsWith("firstmate-")) {
    throw new Error("Only FirstMate project sessions open as control tabs");
  }
  const slug = validateProjectSlug(sessionName.slice("firstmate-".length));
  const projectSessionId = tmux.resolveSession(sessionName);
  const controlSessionId = tmux.resolveSession(
    targetForPandamateService("home"),
  );

  const projectWindowId = validateStableWindowId(
    tmux.run([
      "display-message",
      "-p",
      "-t",
      `${projectSessionId}:0`,
      "#{window_id}",
    ]),
  );

  const controlWindows = listControlWindows(tmux, controlSessionId);
  const linked = controlWindows.find((window) => window.id === projectWindowId);
  const targetIndex = linked
    ? linked.index
    : controlWindows.reduce((max, window) => Math.max(max, window.index), -1) +
      1;
  const targetWindow = `${controlSessionId}:${targetIndex}`;

  if (!linked) {
    tmux.run(["link-window", "-s", `${projectSessionId}:0`, "-t", targetWindow]);
    tmux.run([
      "set-window-option",
      "-t",
      targetWindow,
      "automatic-rename",
      "off",
    ]);
    tmux.run(["rename-window", "-t", targetWindow, slug]);
  }

  tmux.run(["set-option", "-t", controlSessionId, "status", "on"]);
  tmux.run(["select-window", "-t", targetWindow]);
  return projectSessionId;
}

/**
 * Close a FirstMate's Pandamate home tab without stopping the FirstMate. The
 * linked window is unlinked from `pandamate:home` while the project keeps
 * running in its own durable session, focus returns to the home base window,
 * and once the last project tab is gone the tab strip is hidden again so home
 * is a clean full-screen surface. Idempotent and a safe no-op when home is not
 * running, the project session is already gone, or it was never opened as a
 * tab. Returns true only when a tab was actually unlinked.
 */
export function closeControlTab(
  tmux: Pick<TmuxClient, "run" | "resolveSession">,
  sessionName: string,
): boolean {
  if (isPandamateControlSession(sessionName)) {
    throw new Error("Cannot close a Pandamate control session tab");
  }
  if (!sessionName.startsWith("firstmate-")) {
    throw new Error("Only FirstMate project sessions have control tabs");
  }

  let controlSessionId: string;
  try {
    controlSessionId = tmux.resolveSession(targetForPandamateService("home"));
  } catch {
    return false;
  }

  let projectWindowId: string;
  try {
    const projectSessionId = tmux.resolveSession(sessionName);
    projectWindowId = validateStableWindowId(
      tmux.run([
        "display-message",
        "-p",
        "-t",
        `${projectSessionId}:0`,
        "#{window_id}",
      ]),
    );
  } catch {
    return false;
  }

  const controlWindows = listControlWindows(tmux, controlSessionId);
  const linked = controlWindows.find((window) => window.id === projectWindowId);
  if (!linked) {
    return false;
  }

  tmux.run(["unlink-window", "-t", `${controlSessionId}:${linked.index}`]);

  const remaining = controlWindows.filter(
    (window) => window.id !== projectWindowId,
  );
  const homeIndex = remaining.reduce(
    (min, window) => Math.min(min, window.index),
    linked.index,
  );
  const projectTabsLeft = remaining.some((window) => window.index !== homeIndex);
  if (!projectTabsLeft) {
    tmux.run(["set-option", "-t", controlSessionId, "status", "off"]);
  }
  tmux.run(["select-window", "-t", `${controlSessionId}:${homeIndex}`]);
  return true;
}

export const gracefulShutdownPrompt = `Всех матросов увольняем и готовимся к полному закрытию. Выполни штатный graceful shutdown этого FirstMate: сохрани состояние и checkpoint для последующего продолжения; корректно заверши всех своих матросов, дочерние сессии, процессы, серверы и соединения; если это Arcadia и workspace смонтирован, безопасно размонтируй его установленным для проекта способом. Не трогай чужие проекты, чужие tmux-сессии и pandamate:* control-plane sessions. Свою tmux-сессию закрой самостоятельно только самым последним шагом, когда всё остальное уже завершено. Это явная команда на полное корректное закрытие — выполни её до конца.`;

export const resetFirstMatePrompt = `Делаем полный Reset этого FirstMate. Сначала штатно сверни текущую смену: сохрани checkpoint, уволь всех матросов, корректно заверши дочерние сессии, процессы, Watcher, серверы и соединения, освободи временные ресурсы. Затем заново полностью разверни FirstMate по обычной процедуре этого проекта: восстанови Watcher, служебные tmux-вкладки и всё необходимое для новой смены. Главный pane в tmux window 0 и основную tmux-сессию не закрывай — они нужны, чтобы завершить повторное развёртывание. Не трогай чужие проекты, чужие tmux-сессии и pandamate:* control-plane sessions. Это явная команда на последовательный graceful stop и последующий deploy; выполни обе части до конца.`;

function requestFirstMateInstruction(
  tmux: Pick<TmuxClient, "activePaneInWindowZero" | "sendTextAndEnter">,
  sessionName: string,
  prompt: string,
): { readonly pane: string } {
  if (
    sessionName.length === 0 ||
    sessionName.length > 80 ||
    isPandamateControlSession(sessionName) ||
    sessionName.includes("\0") ||
    sessionName.includes("\n")
  ) {
    throw new Error(`Unsafe FirstMate session name: ${sessionName}`);
  }
  const pane = tmux.activePaneInWindowZero(sessionName);
  tmux.sendTextAndEnter(pane, prompt);
  return { pane };
}

export function requestGracefulSessionShutdown(
  tmux: Pick<TmuxClient, "activePaneInWindowZero" | "sendTextAndEnter">,
  sessionName: string,
): { readonly pane: string } {
  return requestFirstMateInstruction(tmux, sessionName, gracefulShutdownPrompt);
}

export function requestFirstMateReset(
  tmux: Pick<TmuxClient, "activePaneInWindowZero" | "sendTextAndEnter">,
  sessionName: string,
): { readonly pane: string } {
  return requestFirstMateInstruction(tmux, sessionName, resetFirstMatePrompt);
}
