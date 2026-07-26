import { createHash } from "node:crypto";
import { basename, isAbsolute, normalize } from "node:path";

export const projectKinds = ["arc", "git", "docs"] as const;
export type ProjectKind = (typeof projectKinds)[number];

export const firstMateProfiles = [
  "FirstMateArc",
  "FirstMateGit",
  "DocResearch",
] as const;
export type FirstMateProfile = (typeof firstMateProfiles)[number];

export interface ProjectOnboarding {
  readonly profile: FirstMateProfile;
  readonly project: CreateProjectInput;
}

export const desiredStates = ["running", "stopped"] as const;
export type DesiredState = (typeof desiredStates)[number];

export const actualStates = [
  "registered",
  "starting",
  "running",
  "working",
  "waiting",
  "failed",
  "recovering",
  "sleeping",
  "stopped",
] as const;
export type ActualState = (typeof actualStates)[number];

export interface Project {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly kind: ProjectKind;
  readonly workspace: string;
  readonly desiredState: DesiredState;
  readonly actualState: ActualState;
  readonly tmuxTarget: string | null;
  readonly tmuxSessionName: string | null;
  readonly currentSummary: string;
  readonly attentionLevel: "none" | "info" | "action" | "urgent";
  readonly lastHeartbeatAt: string | null;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateProjectInput {
  readonly slug: string;
  readonly title: string;
  readonly kind: ProjectKind;
  readonly workspace: string;
}

export interface AdoptTmuxSessionInput {
  readonly slug: string;
  readonly sessionName: string;
}

export interface EventRecord {
  readonly id: string;
  readonly sequence: number;
  readonly occurredAt: string;
  readonly recordedAt: string;
  readonly type: string;
  readonly projectId: string | null;
  readonly actor: {
    readonly kind: "user" | "daemon" | "cli" | "system";
    readonly id: string;
  };
  readonly correlationId: string | null;
  readonly causationId: string | null;
  readonly schemaVersion: 1;
  readonly payload: Readonly<Record<string, unknown>>;
}

export const messagePriorities = ["normal", "high", "urgent"] as const;
export type MessagePriority = (typeof messagePriorities)[number];
export const messageStatuses = [
  "queued",
  "leased",
  "acknowledged",
  "applied",
  "resolved",
  "failed",
  "dead-letter",
] as const;
export type MessageStatus = (typeof messageStatuses)[number];

export interface Message {
  readonly id: string;
  readonly projectId: string;
  readonly projectSlug: string;
  readonly text: string;
  readonly priority: MessagePriority;
  readonly status: MessageStatus;
  readonly leaseOwner: string | null;
  readonly leaseExpiresAt: string | null;
  readonly attempts: number;
  readonly acknowledgement: string | null;
  readonly resolution: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateMessageInput {
  readonly projectSlug: string;
  readonly text: string;
  readonly priority: MessagePriority;
}

export interface FirstMateStatus {
  readonly projectSlug: string;
  readonly state: "working" | "waiting" | "sleeping" | "failed";
  readonly activity: string;
  readonly goal: string;
  readonly progress:
    | { readonly kind: "steps"; readonly done: number; readonly total: number }
    | null;
  readonly iteration: number;
  readonly attention: "none" | "info" | "action" | "urgent";
  readonly safeToInterrupt: boolean;
  readonly checkpointId: string | null;
  readonly timestamp: string;
}

export interface Checkpoint {
  readonly id: string;
  readonly projectId: string;
  readonly projectSlug: string;
  readonly goal: string;
  readonly phase: string;
  readonly completed: readonly string[];
  readonly pending: readonly string[];
  readonly nextSafeAction: string;
  readonly externalSideEffects: readonly string[];
  readonly createdAt: string;
}

export interface Timer {
  readonly id: string;
  readonly projectId: string;
  readonly projectSlug: string;
  readonly dueAt: string;
  readonly text: string;
  readonly priority: MessagePriority;
  readonly status: "pending" | "fired" | "cancelled";
  readonly firedMessageId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateTimerInput {
  readonly projectSlug: string;
  readonly dueAt: string;
  readonly text: string;
  readonly priority: MessagePriority;
}

export interface HookInput {
  readonly projectSlug: string;
  readonly hookId: string;
  readonly eventType: string;
  readonly occurredAt: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface Decision {
  readonly id: string;
  readonly topic: string;
  readonly value: string;
  readonly summary: string;
  readonly source: string;
  readonly status: "active" | "superseded";
  readonly supersedesId: string | null;
  readonly createdAt: string;
  readonly supersededAt: string | null;
}

export interface RecordDecisionInput {
  readonly topic: string;
  readonly value: string;
  readonly summary: string;
  readonly source: string;
}

function boundedText(
  value: unknown,
  label: string,
  maximum: number,
  allowEmpty = false,
): string {
  if (
    typeof value !== "string" ||
    (!allowEmpty && value.trim().length === 0) ||
    value.length > maximum ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)
  ) {
    throw new Error(`Invalid ${label}`);
  }
  return value.trim();
}

export function validateCreateMessageInput(value: unknown): CreateMessageInput {
  if (typeof value !== "object" || value === null) {
    throw new Error("Message input must be an object");
  }
  const input = value as Record<string, unknown>;
  if (
    typeof input.priority !== "string" ||
    !messagePriorities.includes(input.priority as MessagePriority)
  ) {
    throw new Error("Invalid message priority");
  }
  return {
    projectSlug: validateProjectSlug(input.projectSlug),
    text: boundedText(input.text, "message text", 8_192),
    priority: input.priority as MessagePriority,
  };
}

export function validateCreateTimerInput(value: unknown): CreateTimerInput {
  if (typeof value !== "object" || value === null) {
    throw new Error("Timer input must be an object");
  }
  const input = value as Record<string, unknown>;
  const message = validateCreateMessageInput(input);
  if (
    typeof input.dueAt !== "string" ||
    !Number.isFinite(Date.parse(input.dueAt))
  ) {
    throw new Error("Invalid timer due timestamp");
  }
  return { ...message, dueAt: new Date(input.dueAt).toISOString() };
}

export function validateHookInput(value: unknown): HookInput {
  if (typeof value !== "object" || value === null) {
    throw new Error("Hook input must be an object");
  }
  const input = value as Record<string, unknown>;
  if (
    typeof input.hookId !== "string" ||
    !/^[A-Za-z0-9._:-]{8,160}$/.test(input.hookId) ||
    typeof input.eventType !== "string" ||
    !/^[a-z][a-z0-9_.-]{0,119}$/.test(input.eventType) ||
    typeof input.occurredAt !== "string" ||
    !Number.isFinite(Date.parse(input.occurredAt)) ||
    typeof input.payload !== "object" ||
    input.payload === null ||
    Array.isArray(input.payload)
  ) {
    throw new Error("Invalid hook input");
  }
  let encoded: string;
  try {
    encoded = JSON.stringify(input.payload);
  } catch {
    throw new Error("Hook payload must be JSON serializable");
  }
  if (Buffer.byteLength(encoded) > 64 * 1024) {
    throw new Error("Hook payload exceeds 64 KiB");
  }
  return {
    projectSlug: validateProjectSlug(input.projectSlug),
    hookId: input.hookId,
    eventType: input.eventType,
    occurredAt: new Date(input.occurredAt).toISOString(),
    payload: input.payload as Readonly<Record<string, unknown>>,
  };
}

export function validateRecordDecisionInput(
  value: unknown,
): RecordDecisionInput {
  if (typeof value !== "object" || value === null) {
    throw new Error("Decision input must be an object");
  }
  const input = value as Record<string, unknown>;
  if (
    typeof input.topic !== "string" ||
    !/^[a-z0-9](?:[a-z0-9._-]{0,118}[a-z0-9])?$/.test(input.topic)
  ) {
    throw new Error("Invalid decision topic");
  }
  return {
    topic: input.topic,
    value: boundedText(input.value, "decision value", 8_192),
    summary: boundedText(input.summary, "decision summary", 500),
    source: boundedText(input.source, "decision source", 500),
  };
}

export function validateFirstMateStatus(value: unknown): FirstMateStatus {
  if (typeof value !== "object" || value === null) {
    throw new Error("FirstMate status must be an object");
  }
  const input = value as Record<string, unknown>;
  const states = ["working", "waiting", "sleeping", "failed"] as const;
  const attention = ["none", "info", "action", "urgent"] as const;
  if (
    typeof input.state !== "string" ||
    !states.includes(input.state as (typeof states)[number]) ||
    typeof input.attention !== "string" ||
    !attention.includes(input.attention as (typeof attention)[number]) ||
    typeof input.iteration !== "number" ||
    !Number.isSafeInteger(input.iteration) ||
    input.iteration < 0 ||
    typeof input.safeToInterrupt !== "boolean" ||
    typeof input.timestamp !== "string" ||
    !Number.isFinite(Date.parse(input.timestamp))
  ) {
    throw new Error("Invalid FirstMate status fields");
  }
  let progress: FirstMateStatus["progress"] = null;
  if (input.progress !== null && input.progress !== undefined) {
    if (typeof input.progress !== "object") {
      throw new Error("Invalid status progress");
    }
    const candidate = input.progress as Record<string, unknown>;
    if (
      candidate.kind !== "steps" ||
      typeof candidate.done !== "number" ||
      !Number.isSafeInteger(candidate.done) ||
      candidate.done < 0 ||
      typeof candidate.total !== "number" ||
      !Number.isSafeInteger(candidate.total) ||
      candidate.total < 1 ||
      candidate.done > candidate.total
    ) {
      throw new Error("Invalid status progress");
    }
    progress = {
      kind: "steps",
      done: candidate.done,
      total: candidate.total,
    };
  }
  return {
    projectSlug: validateProjectSlug(input.projectSlug),
    state: input.state as FirstMateStatus["state"],
    activity: boundedText(input.activity, "status activity", 240),
    goal: boundedText(input.goal, "status goal", 500),
    progress,
    iteration: input.iteration,
    attention: input.attention as FirstMateStatus["attention"],
    safeToInterrupt: input.safeToInterrupt,
    checkpointId:
      input.checkpointId === null || input.checkpointId === undefined
        ? null
        : boundedText(input.checkpointId, "checkpoint id", 120),
    timestamp: input.timestamp,
  };
}

function boundedTextList(
  value: unknown,
  label: string,
  maximumItems: number,
): readonly string[] {
  if (!Array.isArray(value) || value.length > maximumItems) {
    throw new Error(`Invalid ${label}`);
  }
  return value.map((item) => boundedText(item, label, 500));
}

export function validateCheckpointInput(value: unknown): Omit<
  Checkpoint,
  "id" | "projectId" | "createdAt"
> {
  if (typeof value !== "object" || value === null) {
    throw new Error("Checkpoint input must be an object");
  }
  const input = value as Record<string, unknown>;
  return {
    projectSlug: validateProjectSlug(input.projectSlug),
    goal: boundedText(input.goal, "checkpoint goal", 1_000),
    phase: boundedText(input.phase, "checkpoint phase", 240),
    completed: boundedTextList(input.completed, "completed steps", 100),
    pending: boundedTextList(input.pending, "pending steps", 100),
    nextSafeAction: boundedText(
      input.nextSafeAction,
      "next safe action",
      1_000,
    ),
    externalSideEffects: boundedTextList(
      input.externalSideEffects,
      "external side effects",
      100,
    ),
  };
}

export function isProjectKind(value: unknown): value is ProjectKind {
  return typeof value === "string" && projectKinds.includes(value as ProjectKind);
}

export function validateProjectSlug(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/.test(value)
  ) {
    throw new Error(
      "Project slug must be 1-48 lowercase letters, digits, or hyphens",
    );
  }
  if (
    value === "home" ||
    value === "write" ||
    value === "idle-probe" ||
    value === "probe-keeper" ||
    value.startsWith("control-") ||
    value.startsWith("service-")
  ) {
    throw new Error("Project slug is reserved for a Pandamate service");
  }
  return value;
}

export function validateProjectTitle(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.length > 120 ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new Error("Project title must be 1-120 printable characters");
  }
  return value.trim();
}

export function validateWorkspace(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 1024 ||
    !isAbsolute(value) ||
    value.includes("\u0000")
  ) {
    throw new Error("Project workspace must be a canonical absolute path");
  }
  const canonical = normalize(value);
  if (canonical !== value) {
    throw new Error("Project workspace must be normalized");
  }
  return canonical;
}

export function validateCreateProjectInput(value: unknown): CreateProjectInput {
  if (typeof value !== "object" || value === null) {
    throw new Error("Project input must be an object");
  }
  const input = value as Record<string, unknown>;
  if (!isProjectKind(input.kind)) {
    throw new Error("Project kind must be arc, git, or docs");
  }
  return {
    slug: validateProjectSlug(input.slug),
    title: validateProjectTitle(input.title),
    kind: input.kind,
    workspace: validateWorkspace(input.workspace),
  };
}

export function projectKindForProfile(
  profile: FirstMateProfile,
): ProjectKind {
  switch (profile) {
    case "FirstMateArc":
      return "arc";
    case "FirstMateGit":
      return "git";
    case "DocResearch":
      return "docs";
  }
}

export function profileForProjectKind(kind: ProjectKind): FirstMateProfile {
  switch (kind) {
    case "arc":
      return "FirstMateArc";
    case "git":
      return "FirstMateGit";
    case "docs":
      return "DocResearch";
  }
}

export function validateFirstMateProfile(value: unknown): FirstMateProfile {
  if (typeof value !== "string") {
    throw new Error("FirstMate profile must be a string");
  }
  const normalized = value.toLowerCase().replaceAll(/[\s_-]/g, "");
  if (normalized === "firstmatearc" || normalized === "arc") {
    return "FirstMateArc";
  }
  if (normalized === "firstmategit" || normalized === "git") {
    return "FirstMateGit";
  }
  if (
    normalized === "docresearch" ||
    normalized === "firstmatedocs" ||
    normalized === "docs"
  ) {
    return "DocResearch";
  }
  throw new Error(
    "Profile must be FirstMateArc, FirstMateGit, or DocResearch",
  );
}

export function deriveProjectSlug(workspace: string): string {
  const canonical = validateWorkspace(workspace);
  const base = basename(canonical)
    .normalize("NFKD")
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "")
    .slice(0, 48)
    .replaceAll(/-+$/g, "");
  if (base) {
    return validateProjectSlug(base);
  }
  return `project-${createHash("sha256").update(canonical).digest("hex").slice(0, 8)}`;
}

export function buildProjectOnboarding(
  rawProfile: unknown,
  rawWorkspace: unknown,
  rawTitle?: unknown,
): ProjectOnboarding {
  const profile = validateFirstMateProfile(rawProfile);
  const workspace = validateWorkspace(rawWorkspace);
  const fallbackTitle = basename(workspace);
  return {
    profile,
    project: {
      slug: deriveProjectSlug(workspace),
      title: validateProjectTitle(rawTitle ?? fallbackTitle),
      kind: projectKindForProfile(profile),
      workspace,
    },
  };
}

export function parseProjectOnboardingText(text: unknown): ProjectOnboarding {
  if (
    typeof text !== "string" ||
    text.trim().length === 0 ||
    text.length > 2048
  ) {
    throw new Error("Pandamate input must be 1-2048 characters");
  }
  const profileMatch = text.match(
    /\b(firstmate[\s_-]*arc|firstmate[\s_-]*git|doc[\s_-]*research|firstmate[\s_-]*docs|arc|git|docs)\b/i,
  );
  if (!profileMatch) {
    throw new Error(
      "Name a profile: FirstMateArc, FirstMateGit, or DocResearch",
    );
  }
  const profile = validateFirstMateProfile(profileMatch[1]);
  const quotedPath = text.match(/["'](\/[^"']+)["']/)?.[1];
  let workspace = quotedPath;
  if (!workspace) {
    const pathStart = text.indexOf("/");
    if (pathStart !== -1) {
      workspace = text
        .slice(pathStart)
        .replace(
          /\s+(?:как|as)?\s*(?:firstmate[\s_-]*(?:arc|git|docs)|doc[\s_-]*research|arc|git|docs)\b.*$/i,
          "",
        )
        .trim();
    }
  }
  if (!workspace) {
    throw new Error("Include a normalized absolute workspace path");
  }
  return buildProjectOnboarding(profile, workspace);
}

export function validateIdempotencyKey(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length < 8 ||
    value.length > 120 ||
    !/^[A-Za-z0-9._:-]+$/.test(value)
  ) {
    throw new Error("Invalid idempotency key");
  }
  return value;
}

export function validateTmuxSessionName(value: unknown): string {
  const sessionName = validateRuntimeSessionName(value);
  if (sessionName.startsWith("pandamate:")) {
    throw new Error("Invalid adoptable tmux session name");
  }
  return sessionName;
}

export function validateRuntimeSessionName(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 80 ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new Error("Invalid tmux session name");
  }
  return value;
}

export function validateTmuxTarget(value: unknown): string {
  if (typeof value !== "string" || !/^\$\d+$/.test(value)) {
    throw new Error("Invalid stable tmux session target");
  }
  return value;
}

export function validateAdoptTmuxSessionInput(
  value: unknown,
): AdoptTmuxSessionInput {
  if (typeof value !== "object" || value === null) {
    throw new Error("Tmux adoption input must be an object");
  }
  const input = value as Record<string, unknown>;
  return {
    slug: validateProjectSlug(input.slug),
    sessionName: validateTmuxSessionName(input.sessionName),
  };
}
