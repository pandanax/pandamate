import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { isAbsolute, normalize } from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
  validateCreateProjectInput,
  validateCreateMessageInput,
  validateCreateTimerInput,
  validateCheckpointInput,
  validateFirstMateStatus,
  validateHookInput,
  validateRecordDecisionInput,
  validateIdempotencyKey,
  validateProjectSlug,
  validateRuntimeSessionName,
  validateTmuxSessionName,
  validateTmuxTarget,
  actualStates,
  type ActualState,
  type CreateProjectInput,
  type DesiredState,
  type EventRecord,
  type Checkpoint,
  type CreateMessageInput,
  type FirstMateStatus,
  type Message,
  type MessageStatus,
  type HookInput,
  type Decision,
  type RecordDecisionInput,
  type Project,
  type Timer,
} from "@pandamate/domain";

type IdPrefix = "prj" | "evt" | "msg" | "chk" | "tmr" | "dec";
interface StorageOptions {
  readonly now?: () => Date;
  readonly createId?: (prefix: IdPrefix) => string;
}

type SqlRow = Record<string, string | number | bigint | Uint8Array | null>;

const migrations = [
  {
    version: 1,
    sql: `
      CREATE TABLE projects (
        id TEXT PRIMARY KEY,
        slug TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('arc', 'git', 'docs')),
        workspace TEXT NOT NULL,
        desired_state TEXT NOT NULL CHECK (desired_state IN ('running', 'stopped')),
        actual_state TEXT NOT NULL,
        tmux_target TEXT,
        current_summary TEXT NOT NULL,
        attention_level TEXT NOT NULL,
        last_heartbeat_at TEXT,
        version INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE events (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE,
        occurred_at TEXT NOT NULL,
        recorded_at TEXT NOT NULL,
        type TEXT NOT NULL,
        project_id TEXT REFERENCES projects(id),
        actor_kind TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        correlation_id TEXT,
        causation_id TEXT,
        schema_version INTEGER NOT NULL,
        payload_json TEXT NOT NULL
      ) STRICT;

      CREATE INDEX events_project_sequence
        ON events(project_id, sequence);

      CREATE TABLE command_results (
        idempotency_key TEXT PRIMARY KEY,
        command_type TEXT NOT NULL,
        response_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT;
    `,
  },
  {
    version: 3,
    sql: `
      CREATE UNIQUE INDEX projects_unique_tmux_target
        ON projects(tmux_target)
        WHERE tmux_target IS NOT NULL;
    `,
  },
  {
    version: 2,
    sql: `
      ALTER TABLE projects ADD COLUMN tmux_session_name TEXT;
      CREATE UNIQUE INDEX projects_tmux_session_name_unique
        ON projects(tmux_session_name)
        WHERE tmux_session_name IS NOT NULL;
    `,
  },
  {
    version: 4,
    sql: `
      CREATE TABLE messages (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id),
        text TEXT NOT NULL,
        priority TEXT NOT NULL CHECK (priority IN ('normal', 'high', 'urgent')),
        status TEXT NOT NULL CHECK (
          status IN (
            'queued', 'leased', 'acknowledged', 'applied', 'resolved',
            'failed', 'dead-letter'
          )
        ),
        lease_owner TEXT,
        lease_expires_at TEXT,
        attempts INTEGER NOT NULL,
        acknowledgement TEXT,
        resolution TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX messages_project_status_created
        ON messages(project_id, status, created_at);

      CREATE TABLE firstmate_status (
        project_id TEXT PRIMARY KEY REFERENCES projects(id),
        payload_json TEXT NOT NULL,
        reported_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE checkpoints (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id),
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX checkpoints_project_created
        ON checkpoints(project_id, created_at);
    `,
  },
  {
    version: 5,
    sql: `
      CREATE TABLE timers (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id),
        due_at TEXT NOT NULL,
        text TEXT NOT NULL,
        priority TEXT NOT NULL CHECK (priority IN ('normal', 'high', 'urgent')),
        status TEXT NOT NULL CHECK (status IN ('pending', 'fired', 'cancelled')),
        fired_message_id TEXT REFERENCES messages(id),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX timers_status_due ON timers(status, due_at);
    `,
  },
  {
    version: 6,
    sql: `
      CREATE TABLE hook_receipts (
        hook_id TEXT PRIMARY KEY,
        event_id TEXT NOT NULL UNIQUE REFERENCES events(id),
        received_at TEXT NOT NULL
      ) STRICT;
    `,
  },
  {
    version: 7,
    sql: `
      CREATE TABLE decisions (
        id TEXT PRIMARY KEY,
        topic TEXT NOT NULL,
        value TEXT NOT NULL,
        summary TEXT NOT NULL,
        source TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('active', 'superseded')),
        supersedes_id TEXT REFERENCES decisions(id),
        created_at TEXT NOT NULL,
        superseded_at TEXT
      ) STRICT;
      CREATE UNIQUE INDEX decisions_one_active_topic
        ON decisions(topic) WHERE status = 'active';
      CREATE INDEX decisions_topic_created ON decisions(topic, created_at);
    `,
  },
] as const;

function text(row: SqlRow, field: string): string {
  const value = row[field];
  if (typeof value !== "string") {
    throw new Error(`Corrupt database field: ${field}`);
  }
  return value;
}

function nullableText(row: SqlRow, field: string): string | null {
  const value = row[field];
  if (value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new Error(`Corrupt database field: ${field}`);
  }
  return value;
}

function integer(row: SqlRow, field: string): number {
  const value = row[field];
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new Error(`Corrupt database field: ${field}`);
  }
  return value;
}

function projectFromRow(row: SqlRow): Project {
  return {
    id: text(row, "id"),
    slug: text(row, "slug"),
    title: text(row, "title"),
    kind: text(row, "kind") as Project["kind"],
    workspace: text(row, "workspace"),
    desiredState: text(row, "desired_state") as Project["desiredState"],
    actualState: text(row, "actual_state") as Project["actualState"],
    tmuxTarget: nullableText(row, "tmux_target"),
    tmuxSessionName: nullableText(row, "tmux_session_name"),
    currentSummary: text(row, "current_summary"),
    attentionLevel: text(
      row,
      "attention_level",
    ) as Project["attentionLevel"],
    lastHeartbeatAt: nullableText(row, "last_heartbeat_at"),
    version: integer(row, "version"),
    createdAt: text(row, "created_at"),
    updatedAt: text(row, "updated_at"),
  };
}

function eventFromRow(row: SqlRow): EventRecord {
  const payload = JSON.parse(text(row, "payload_json")) as unknown;
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new Error("Corrupt event payload");
  }
  return {
    id: text(row, "id"),
    sequence: integer(row, "sequence"),
    occurredAt: text(row, "occurred_at"),
    recordedAt: text(row, "recorded_at"),
    type: text(row, "type"),
    projectId: nullableText(row, "project_id"),
    actor: {
      kind: text(row, "actor_kind") as EventRecord["actor"]["kind"],
      id: text(row, "actor_id"),
    },
    correlationId: nullableText(row, "correlation_id"),
    causationId: nullableText(row, "causation_id"),
    schemaVersion: 1,
    payload: payload as Readonly<Record<string, unknown>>,
  };
}

function messageFromRow(row: SqlRow): Message {
  return {
    id: text(row, "id"),
    projectId: text(row, "project_id"),
    projectSlug: text(row, "project_slug"),
    text: text(row, "text"),
    priority: text(row, "priority") as Message["priority"],
    status: text(row, "status") as MessageStatus,
    leaseOwner: nullableText(row, "lease_owner"),
    leaseExpiresAt: nullableText(row, "lease_expires_at"),
    attempts: integer(row, "attempts"),
    acknowledgement: nullableText(row, "acknowledgement"),
    resolution: nullableText(row, "resolution"),
    createdAt: text(row, "created_at"),
    updatedAt: text(row, "updated_at"),
  };
}

function timerFromRow(row: SqlRow): Timer {
  return {
    id: text(row, "id"),
    projectId: text(row, "project_id"),
    projectSlug: text(row, "project_slug"),
    dueAt: text(row, "due_at"),
    text: text(row, "text"),
    priority: text(row, "priority") as Timer["priority"],
    status: text(row, "status") as Timer["status"],
    firedMessageId: nullableText(row, "fired_message_id"),
    createdAt: text(row, "created_at"),
    updatedAt: text(row, "updated_at"),
  };
}

function decisionFromRow(row: SqlRow): Decision {
  return {
    id: text(row, "id"),
    topic: text(row, "topic"),
    value: text(row, "value"),
    summary: text(row, "summary"),
    source: text(row, "source"),
    status: text(row, "status") as Decision["status"],
    supersedesId: nullableText(row, "supersedes_id"),
    createdAt: text(row, "created_at"),
    supersededAt: nullableText(row, "superseded_at"),
  };
}

export class PandamateStore {
  readonly #database: DatabaseSync;
  readonly #now: () => Date;
  readonly #createId: (prefix: IdPrefix) => string;

  constructor(databasePath: string, options: StorageOptions = {}) {
    this.#now = options.now ?? (() => new Date());
    this.#createId =
      options.createId ?? ((prefix) => `${prefix}_${randomUUID()}`);
    this.#database = new DatabaseSync(databasePath);
    this.#database.exec("PRAGMA journal_mode = WAL");
    this.#database.exec("PRAGMA foreign_keys = ON");
    this.#database.exec("PRAGMA busy_timeout = 5000");
    this.#migrate();
  }

  #migrate(): void {
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      ) STRICT
    `);
    const appliedRows = this.#database
      .prepare("SELECT version FROM schema_migrations ORDER BY version")
      .all() as SqlRow[];
    const applied = new Set(appliedRows.map((row) => integer(row, "version")));

    for (const migration of migrations) {
      if (applied.has(migration.version)) {
        continue;
      }
      this.#database.exec("BEGIN IMMEDIATE");
      try {
        this.#database.exec(migration.sql);
        this.#database
          .prepare(
            "INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)",
          )
          .run(migration.version, this.#now().toISOString());
        this.#database.exec("COMMIT");
      } catch (error) {
        this.#database.exec("ROLLBACK");
        throw error;
      }
    }
  }

  close(): void {
    this.#database.close();
  }

  backupTo(destination: string): {
    readonly path: string;
    readonly checksum: string;
    readonly bytes: number;
  } {
    if (
      !isAbsolute(destination) ||
      normalize(destination) !== destination ||
      destination.includes("\0")
    ) {
      throw new Error("Backup destination must be a normalized absolute path");
    }
    this.#database.prepare("VACUUM INTO ?").run(destination);
    const bytes = readFileSync(destination);
    return {
      path: destination,
      checksum: createHash("sha256").update(bytes).digest("hex"),
      bytes: bytes.byteLength,
    };
  }

  #appendEvent(
    type: string,
    projectId: string | null,
    actorKind: EventRecord["actor"]["kind"],
    actorId: string,
    payload: Readonly<Record<string, unknown>>,
    timestamp: string,
    correlationId: string | null = null,
  ): void {
    this.#database
      .prepare(
        `INSERT INTO events(
          id, occurred_at, recorded_at, type, project_id, actor_kind,
          actor_id, correlation_id, causation_id, schema_version, payload_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        this.#createId("evt"),
        timestamp,
        timestamp,
        type,
        projectId,
        actorKind,
        actorId,
        correlationId,
        null,
        1,
        JSON.stringify(payload),
      );
  }

  createProject(
    rawInput: CreateProjectInput,
    rawIdempotencyKey: string,
  ): Project {
    const input = validateCreateProjectInput(rawInput);
    const idempotencyKey = validateIdempotencyKey(rawIdempotencyKey);
    const existing = this.#database
      .prepare(
        "SELECT response_json FROM command_results WHERE idempotency_key = ?",
      )
      .get(idempotencyKey) as SqlRow | undefined;
    if (existing) {
      return JSON.parse(text(existing, "response_json")) as Project;
    }

    const timestamp = this.#now().toISOString();
    const project: Project = {
      id: this.#createId("prj"),
      slug: input.slug,
      title: input.title,
      kind: input.kind,
      workspace: input.workspace,
      desiredState: "stopped",
      actualState: "registered",
      tmuxTarget: null,
      tmuxSessionName: null,
      currentSummary: "Registered; supervision has not started",
      attentionLevel: "none",
      lastHeartbeatAt: null,
      version: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const eventId = this.#createId("evt");

    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const concurrent = this.#database
        .prepare(
          "SELECT response_json FROM command_results WHERE idempotency_key = ?",
        )
        .get(idempotencyKey) as SqlRow | undefined;
      if (concurrent) {
        this.#database.exec("COMMIT");
        return JSON.parse(text(concurrent, "response_json")) as Project;
      }

      this.#database
        .prepare(
          `INSERT INTO projects(
            id, slug, title, kind, workspace, desired_state, actual_state,
            tmux_target, tmux_session_name, current_summary, attention_level,
            last_heartbeat_at, version, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          project.id,
          project.slug,
          project.title,
          project.kind,
          project.workspace,
          project.desiredState,
          project.actualState,
          project.tmuxTarget,
          project.tmuxSessionName,
          project.currentSummary,
          project.attentionLevel,
          project.lastHeartbeatAt,
          project.version,
          project.createdAt,
          project.updatedAt,
        );
      this.#database
        .prepare(
          `INSERT INTO events(
            id, occurred_at, recorded_at, type, project_id, actor_kind,
            actor_id, correlation_id, causation_id, schema_version, payload_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          eventId,
          timestamp,
          timestamp,
          "project.registered",
          project.id,
          "cli",
          "local-user",
          idempotencyKey,
          null,
          1,
          JSON.stringify({
            slug: project.slug,
            title: project.title,
            kind: project.kind,
            workspace: project.workspace,
          }),
        );
      this.#database
        .prepare(
          `INSERT INTO command_results(
            idempotency_key, command_type, response_json, created_at
          ) VALUES (?, ?, ?, ?)`,
        )
        .run(
          idempotencyKey,
          "project.create",
          JSON.stringify(project),
          timestamp,
        );
      this.#database.exec("COMMIT");
      return project;
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  listProjects(): readonly Project[] {
    const rows = this.#database
      .prepare("SELECT * FROM projects ORDER BY slug")
      .all() as SqlRow[];
    return rows.map(projectFromRow);
  }

  getProject(rawSlug: string): Project | null {
    const slug = validateProjectSlug(rawSlug);
    const row = this.#database
      .prepare("SELECT * FROM projects WHERE slug = ?")
      .get(slug) as SqlRow | undefined;
    return row ? projectFromRow(row) : null;
  }

  setProjectDesiredState(
    rawSlug: string,
    desiredState: DesiredState,
    rawIdempotencyKey: string,
  ): Project {
    const slug = validateProjectSlug(rawSlug);
    if (desiredState !== "running" && desiredState !== "stopped") {
      throw new Error("Invalid desired project state");
    }
    const idempotencyKey = validateIdempotencyKey(rawIdempotencyKey);
    const existing = this.#database
      .prepare(
        "SELECT response_json FROM command_results WHERE idempotency_key = ?",
      )
      .get(idempotencyKey) as SqlRow | undefined;
    if (existing) {
      return JSON.parse(text(existing, "response_json")) as Project;
    }

    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const currentRow = this.#database
        .prepare("SELECT * FROM projects WHERE slug = ?")
        .get(slug) as SqlRow | undefined;
      if (!currentRow) {
        throw new Error(`Unknown project: ${slug}`);
      }
      const current = projectFromRow(currentRow);
      const timestamp = this.#now().toISOString();
      const updated: Project =
        current.desiredState === desiredState
          ? current
          : {
              ...current,
              desiredState,
              actualState:
                desiredState === "running" &&
                (current.actualState === "registered" ||
                  current.actualState === "stopped" ||
                  current.actualState === "failed")
                  ? "starting"
                  : current.actualState,
              currentSummary:
                desiredState === "running"
                  ? "Start requested; awaiting runtime reconciliation"
                  : "Stop requested; awaiting runtime reconciliation",
              version: current.version + 1,
              updatedAt: timestamp,
            };

      if (updated !== current) {
        this.#database
          .prepare(
            `UPDATE projects
             SET desired_state = ?, actual_state = ?, current_summary = ?,
                 version = ?, updated_at = ?
             WHERE id = ? AND version = ?`,
          )
          .run(
            updated.desiredState,
            updated.actualState,
            updated.currentSummary,
            updated.version,
            updated.updatedAt,
            updated.id,
            current.version,
          );
        this.#database
          .prepare(
            `INSERT INTO events(
              id, occurred_at, recorded_at, type, project_id, actor_kind,
              actor_id, correlation_id, causation_id, schema_version, payload_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            this.#createId("evt"),
            timestamp,
            timestamp,
            "project.desired_state.changed",
            updated.id,
            "cli",
            "local-user",
            idempotencyKey,
            null,
            1,
            JSON.stringify({
              from: current.desiredState,
              to: updated.desiredState,
              slug: updated.slug,
            }),
          );
      }
      this.#database
        .prepare(
          `INSERT INTO command_results(
            idempotency_key, command_type, response_json, created_at
          ) VALUES (?, ?, ?, ?)`,
        )
        .run(
          idempotencyKey,
          "project.desired.set",
          JSON.stringify(updated),
          timestamp,
        );
      this.#database.exec("COMMIT");
      return updated;
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  adoptProjectTmuxSession(
    rawSlug: string,
    rawTmuxTarget: string,
    rawSessionName: string,
    livePaneCount: number,
    rawIdempotencyKey: string,
  ): Project {
    const slug = validateProjectSlug(rawSlug);
    const tmuxTarget = validateTmuxTarget(rawTmuxTarget);
    const sessionName = validateTmuxSessionName(rawSessionName);
    if (!Number.isSafeInteger(livePaneCount) || livePaneCount < 1) {
      throw new Error("Adopted tmux session must have a live pane");
    }
    const idempotencyKey = validateIdempotencyKey(rawIdempotencyKey);
    const existing = this.#database
      .prepare(
        "SELECT response_json FROM command_results WHERE idempotency_key = ?",
      )
      .get(idempotencyKey) as SqlRow | undefined;
    if (existing) {
      return JSON.parse(text(existing, "response_json")) as Project;
    }

    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const currentRow = this.#database
        .prepare("SELECT * FROM projects WHERE slug = ?")
        .get(slug) as SqlRow | undefined;
      if (!currentRow) {
        throw new Error(`Unknown project: ${slug}`);
      }
      const current = projectFromRow(currentRow);
      if (current.tmuxTarget && current.tmuxTarget !== tmuxTarget) {
        throw new Error(
          `Project ${slug} is already associated with ${current.tmuxTarget}`,
        );
      }
      const ownerRow = this.#database
        .prepare("SELECT slug FROM projects WHERE tmux_target = ? AND id != ?")
        .get(tmuxTarget, current.id) as SqlRow | undefined;
      if (ownerRow) {
        throw new Error(
          `Tmux target ${tmuxTarget} is already associated with ${text(ownerRow, "slug")}`,
        );
      }

      const timestamp = this.#now().toISOString();
      const changed =
        current.tmuxTarget !== tmuxTarget ||
        current.desiredState !== "running" ||
        current.actualState !== "running";
      const updated: Project = changed
        ? {
            ...current,
            desiredState: "running",
            actualState: "running",
            tmuxTarget,
            tmuxSessionName: sessionName,
            currentSummary: `Adopted tmux session ${sessionName} with ${livePaneCount} live pane${livePaneCount === 1 ? "" : "s"}`,
            version: current.version + 1,
            updatedAt: timestamp,
          }
        : current;

      if (changed) {
        const result = this.#database
          .prepare(
            `UPDATE projects
             SET desired_state = ?, actual_state = ?, tmux_target = ?,
                 tmux_session_name = ?, current_summary = ?, version = ?,
                 updated_at = ?
             WHERE id = ? AND version = ?`,
          )
          .run(
            updated.desiredState,
            updated.actualState,
            updated.tmuxTarget,
            updated.tmuxSessionName,
            updated.currentSummary,
            updated.version,
            updated.updatedAt,
            updated.id,
            current.version,
          );
        if (result.changes !== 1) {
          throw new Error(`Concurrent project update: ${slug}`);
        }
        this.#database
          .prepare(
            `INSERT INTO events(
              id, occurred_at, recorded_at, type, project_id, actor_kind,
              actor_id, correlation_id, causation_id, schema_version, payload_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            this.#createId("evt"),
            timestamp,
            timestamp,
            "project.tmux.adopted",
            updated.id,
            "daemon",
            "tmux-reconciler",
            idempotencyKey,
            null,
            1,
            JSON.stringify({
              slug: updated.slug,
              sessionName,
              tmuxTarget,
              livePaneCount,
              priorDesiredState: current.desiredState,
              priorActualState: current.actualState,
            }),
          );
      }
      this.#database
        .prepare(
          `INSERT INTO command_results(
            idempotency_key, command_type, response_json, created_at
          ) VALUES (?, ?, ?, ?)`,
        )
        .run(
          idempotencyKey,
          "project.tmux.adopt",
          JSON.stringify(updated),
          timestamp,
        );
      this.#database.exec("COMMIT");
      return updated;
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  recordProjectRuntime(
    rawSlug: string,
    observation: {
      readonly actualState: ActualState;
      readonly tmuxTarget: string | null;
      readonly tmuxSessionName: string | null;
      readonly currentSummary: string;
      readonly lastHeartbeatAt: string | null;
    },
  ): Project {
    const slug = validateProjectSlug(rawSlug);
    if (!actualStates.includes(observation.actualState)) {
      throw new Error(`Invalid actual state: ${observation.actualState}`);
    }
    const tmuxTarget =
      observation.tmuxTarget === null
        ? null
        : validateTmuxTarget(observation.tmuxTarget);
    const tmuxSessionName =
      observation.tmuxSessionName === null
        ? null
        : validateRuntimeSessionName(observation.tmuxSessionName);
    if (
      observation.currentSummary.length === 0 ||
      observation.currentSummary.length > 240 ||
      /[\u0000-\u001f\u007f]/.test(observation.currentSummary)
    ) {
      throw new Error("Invalid runtime summary");
    }
    if (
      observation.lastHeartbeatAt !== null &&
      !Number.isFinite(Date.parse(observation.lastHeartbeatAt))
    ) {
      throw new Error("Invalid heartbeat timestamp");
    }

    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const currentRow = this.#database
        .prepare("SELECT * FROM projects WHERE slug = ?")
        .get(slug) as SqlRow | undefined;
      if (!currentRow) {
        throw new Error(`Unknown project: ${slug}`);
      }
      const current = projectFromRow(currentRow);
      const changed =
        current.actualState !== observation.actualState ||
        current.tmuxTarget !== tmuxTarget ||
        current.tmuxSessionName !== tmuxSessionName ||
        current.currentSummary !== observation.currentSummary ||
        current.lastHeartbeatAt !== observation.lastHeartbeatAt;
      if (!changed) {
        this.#database.exec("COMMIT");
        return current;
      }
      const timestamp = this.#now().toISOString();
      const updated: Project = {
        ...current,
        actualState: observation.actualState,
        tmuxTarget,
        tmuxSessionName,
        currentSummary: observation.currentSummary,
        lastHeartbeatAt: observation.lastHeartbeatAt,
        version: current.version + 1,
        updatedAt: timestamp,
      };
      const owner = tmuxTarget
        ? (this.#database
            .prepare("SELECT slug FROM projects WHERE tmux_target = ? AND id != ?")
            .get(tmuxTarget, current.id) as SqlRow | undefined)
        : undefined;
      if (owner) {
        throw new Error(
          `Tmux target ${tmuxTarget} is already associated with ${text(owner, "slug")}`,
        );
      }
      const result = this.#database
        .prepare(
          `UPDATE projects
           SET actual_state = ?, tmux_target = ?, tmux_session_name = ?,
               current_summary = ?, last_heartbeat_at = ?, version = ?,
               updated_at = ?
           WHERE id = ? AND version = ?`,
        )
        .run(
          updated.actualState,
          updated.tmuxTarget,
          updated.tmuxSessionName,
          updated.currentSummary,
          updated.lastHeartbeatAt,
          updated.version,
          updated.updatedAt,
          updated.id,
          current.version,
        );
      if (result.changes !== 1) {
        throw new Error(`Concurrent project update: ${slug}`);
      }
      this.#database
        .prepare(
          `INSERT INTO events(
            id, occurred_at, recorded_at, type, project_id, actor_kind,
            actor_id, correlation_id, causation_id, schema_version, payload_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          this.#createId("evt"),
          timestamp,
          timestamp,
          "project.runtime.observed",
          updated.id,
          "daemon",
          "tmux-reconciler",
          null,
          null,
          1,
          JSON.stringify({
            slug,
            from: {
              actualState: current.actualState,
              tmuxTarget: current.tmuxTarget,
            },
            to: {
              actualState: updated.actualState,
              tmuxTarget: updated.tmuxTarget,
            },
            tmuxSessionName: updated.tmuxSessionName,
            summary: updated.currentSummary,
            lastHeartbeatAt: updated.lastHeartbeatAt,
          }),
        );
      this.#database.exec("COMMIT");
      return updated;
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  requestProjectRestart(
    rawSlug: string,
    rawIdempotencyKey: string,
  ): Project {
    const slug = validateProjectSlug(rawSlug);
    const idempotencyKey = validateIdempotencyKey(rawIdempotencyKey);
    const existing = this.#database
      .prepare(
        "SELECT response_json FROM command_results WHERE idempotency_key = ?",
      )
      .get(idempotencyKey) as SqlRow | undefined;
    if (existing) {
      return JSON.parse(text(existing, "response_json")) as Project;
    }
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const currentRow = this.#database
        .prepare("SELECT * FROM projects WHERE slug = ?")
        .get(slug) as SqlRow | undefined;
      if (!currentRow) {
        throw new Error(`Unknown project: ${slug}`);
      }
      const current = projectFromRow(currentRow);
      const timestamp = this.#now().toISOString();
      const updated: Project = {
        ...current,
        desiredState: "running",
        actualState: "recovering",
        currentSummary: "Restart requested; replacing FirstMate runtime",
        version: current.version + 1,
        updatedAt: timestamp,
      };
      this.#database
        .prepare(
          `UPDATE projects
           SET desired_state = ?, actual_state = ?, current_summary = ?,
               version = ?, updated_at = ?
           WHERE id = ? AND version = ?`,
        )
        .run(
          updated.desiredState,
          updated.actualState,
          updated.currentSummary,
          updated.version,
          updated.updatedAt,
          updated.id,
          current.version,
        );
      this.#database
        .prepare(
          `INSERT INTO events(
            id, occurred_at, recorded_at, type, project_id, actor_kind,
            actor_id, correlation_id, causation_id, schema_version, payload_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          this.#createId("evt"),
          timestamp,
          timestamp,
          "project.restart.requested",
          updated.id,
          "cli",
          "local-user",
          idempotencyKey,
          null,
          1,
          JSON.stringify({
            slug,
            priorActualState: current.actualState,
            tmuxTarget: current.tmuxTarget,
          }),
        );
      this.#database
        .prepare(
          `INSERT INTO command_results(
            idempotency_key, command_type, response_json, created_at
          ) VALUES (?, ?, ?, ?)`,
        )
        .run(
          idempotencyKey,
          "project.restart",
          JSON.stringify(updated),
          timestamp,
        );
      this.#database.exec("COMMIT");
      return updated;
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  createMessage(
    rawInput: CreateMessageInput,
    rawIdempotencyKey: string,
  ): Message {
    const input = validateCreateMessageInput(rawInput);
    const idempotencyKey = validateIdempotencyKey(rawIdempotencyKey);
    const replay = this.#database
      .prepare(
        "SELECT response_json FROM command_results WHERE idempotency_key = ?",
      )
      .get(idempotencyKey) as SqlRow | undefined;
    if (replay) {
      return JSON.parse(text(replay, "response_json")) as Message;
    }
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const projectRow = this.#database
        .prepare("SELECT id FROM projects WHERE slug = ?")
        .get(input.projectSlug) as SqlRow | undefined;
      if (!projectRow) {
        throw new Error(`Unknown project: ${input.projectSlug}`);
      }
      const timestamp = this.#now().toISOString();
      const message: Message = {
        id: this.#createId("msg"),
        projectId: text(projectRow, "id"),
        projectSlug: input.projectSlug,
        text: input.text,
        priority: input.priority,
        status: "queued",
        leaseOwner: null,
        leaseExpiresAt: null,
        attempts: 0,
        acknowledgement: null,
        resolution: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      this.#database
        .prepare(
          `INSERT INTO messages(
            id, project_id, text, priority, status, lease_owner,
            lease_expires_at, attempts, acknowledgement, resolution,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          message.id,
          message.projectId,
          message.text,
          message.priority,
          message.status,
          null,
          null,
          0,
          null,
          null,
          timestamp,
          timestamp,
        );
      this.#appendEvent(
        "instruction.queued",
        message.projectId,
        "user",
        "local-user",
        {
          messageId: message.id,
          slug: message.projectSlug,
          priority: message.priority,
          text: message.text,
        },
        timestamp,
        idempotencyKey,
      );
      this.#database
        .prepare(
          `INSERT INTO command_results(
            idempotency_key, command_type, response_json, created_at
          ) VALUES (?, ?, ?, ?)`,
        )
        .run(
          idempotencyKey,
          "message.create",
          JSON.stringify(message),
          timestamp,
        );
      this.#database.exec("COMMIT");
      return message;
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  listMessages(
    rawProjectSlug?: string,
    limit = 100,
  ): readonly Message[] {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
      throw new Error("Invalid message query limit");
    }
    const rows = rawProjectSlug
      ? (this.#database
          .prepare(
            `SELECT m.*, p.slug AS project_slug
             FROM messages m JOIN projects p ON p.id = m.project_id
             WHERE p.slug = ? ORDER BY m.created_at DESC LIMIT ?`,
          )
          .all(validateProjectSlug(rawProjectSlug), limit) as SqlRow[])
      : (this.#database
          .prepare(
            `SELECT m.*, p.slug AS project_slug
             FROM messages m JOIN projects p ON p.id = m.project_id
             ORDER BY m.created_at DESC LIMIT ?`,
          )
          .all(limit) as SqlRow[]);
    return rows.map(messageFromRow);
  }

  leaseMessages(
    rawProjectSlug: string,
    rawLeaseOwner: string,
    leaseMilliseconds: number,
    limit: number,
  ): readonly Message[] {
    const projectSlug = validateProjectSlug(rawProjectSlug);
    const leaseOwner =
      typeof rawLeaseOwner === "string" &&
      /^[A-Za-z0-9._:-]{1,120}$/.test(rawLeaseOwner)
        ? rawLeaseOwner
        : (() => {
            throw new Error("Invalid message lease owner");
          })();
    if (
      !Number.isSafeInteger(leaseMilliseconds) ||
      leaseMilliseconds < 1_000 ||
      leaseMilliseconds > 300_000 ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 20
    ) {
      throw new Error("Invalid message lease bounds");
    }
    const now = this.#now();
    const timestamp = now.toISOString();
    const expiresAt = new Date(
      now.getTime() + leaseMilliseconds,
    ).toISOString();
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const rows = this.#database
        .prepare(
          `SELECT m.id
           FROM messages m JOIN projects p ON p.id = m.project_id
           WHERE p.slug = ?
             AND (
               m.status = 'queued' OR
               (m.status = 'leased' AND m.lease_expires_at <= ?)
             )
             AND m.attempts < 5
           ORDER BY
             CASE m.priority
               WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 ELSE 2
             END,
             m.created_at
           LIMIT ?`,
        )
        .all(projectSlug, timestamp, limit) as SqlRow[];
      for (const row of rows) {
        const messageId = text(row, "id");
        this.#database
          .prepare(
            `UPDATE messages
             SET status = 'leased', lease_owner = ?, lease_expires_at = ?,
                 attempts = attempts + 1, updated_at = ?
             WHERE id = ?`,
          )
          .run(leaseOwner, expiresAt, timestamp, messageId);
        const project = this.getProject(projectSlug);
        this.#appendEvent(
          "instruction.delivered",
          project?.id ?? null,
          "daemon",
          leaseOwner,
          { messageId, slug: projectSlug, leaseExpiresAt: expiresAt },
          timestamp,
        );
      }
      const leased = rows.map((row) => {
        const result = this.#database
          .prepare(
            `SELECT m.*, p.slug AS project_slug
             FROM messages m JOIN projects p ON p.id = m.project_id
             WHERE m.id = ?`,
          )
          .get(text(row, "id")) as SqlRow;
        return messageFromRow(result);
      });
      this.#database.exec("COMMIT");
      return leased;
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  transitionMessage(
    rawMessageId: string,
    rawLeaseOwner: string,
    nextStatus: "acknowledged" | "applied" | "resolved" | "failed",
    rawSummary: string,
  ): Message {
    if (
      !/^msg_[A-Za-z0-9_-]{1,160}$/.test(rawMessageId) ||
      !/^[A-Za-z0-9._:-]{1,120}$/.test(rawLeaseOwner) ||
      !["acknowledged", "applied", "resolved", "failed"].includes(nextStatus) ||
      typeof rawSummary !== "string" ||
      rawSummary.trim().length === 0 ||
      rawSummary.length > 1_000
    ) {
      throw new Error("Invalid message transition");
    }
    const allowed: Readonly<Record<string, readonly MessageStatus[]>> = {
      leased: ["acknowledged", "failed"],
      acknowledged: ["applied", "failed"],
      applied: ["resolved", "failed"],
    };
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const row = this.#database
        .prepare(
          `SELECT m.*, p.slug AS project_slug
           FROM messages m JOIN projects p ON p.id = m.project_id
           WHERE m.id = ?`,
        )
        .get(rawMessageId) as SqlRow | undefined;
      if (!row) {
        throw new Error(`Unknown message: ${rawMessageId}`);
      }
      const current = messageFromRow(row);
      if (current.leaseOwner !== rawLeaseOwner) {
        throw new Error("Message lease is owned by another FirstMate");
      }
      if (!(allowed[current.status] ?? []).includes(nextStatus)) {
        throw new Error(
          `Invalid message transition: ${current.status} -> ${nextStatus}`,
        );
      }
      const timestamp = this.#now().toISOString();
      const acknowledgement =
        nextStatus === "acknowledged"
          ? rawSummary.trim()
          : current.acknowledgement;
      const resolution =
        nextStatus === "resolved" || nextStatus === "failed"
          ? rawSummary.trim()
          : current.resolution;
      this.#database
        .prepare(
          `UPDATE messages
           SET status = ?, acknowledgement = ?, resolution = ?,
               updated_at = ?
           WHERE id = ?`,
        )
        .run(
          nextStatus,
          acknowledgement,
          resolution,
          timestamp,
          current.id,
        );
      this.#appendEvent(
        `instruction.${nextStatus}`,
        current.projectId,
        "daemon",
        rawLeaseOwner,
        {
          messageId: current.id,
          slug: current.projectSlug,
          summary: rawSummary.trim(),
        },
        timestamp,
      );
      const updatedRow = this.#database
        .prepare(
          `SELECT m.*, p.slug AS project_slug
           FROM messages m JOIN projects p ON p.id = m.project_id
           WHERE m.id = ?`,
        )
        .get(current.id) as SqlRow;
      this.#database.exec("COMMIT");
      return messageFromRow(updatedRow);
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  reconcileMessageRetries(limit = 100): number {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
      throw new Error("Invalid message retry limit");
    }
    const timestamp = this.#now().toISOString();
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const rows = this.#database
        .prepare(
          `SELECT m.*, p.slug AS project_slug
           FROM messages m JOIN projects p ON p.id = m.project_id
           WHERE
             m.status = 'failed' OR
             (
               m.status = 'leased' AND m.lease_expires_at <= ?
               AND m.attempts >= 5
             )
           ORDER BY m.updated_at LIMIT ?`,
        )
        .all(timestamp, limit) as SqlRow[];
      for (const row of rows) {
        const message = messageFromRow(row);
        const nextStatus = message.attempts >= 5 ? "dead-letter" : "queued";
        this.#database
          .prepare(
            `UPDATE messages
             SET status = ?, lease_owner = NULL, lease_expires_at = NULL,
                 updated_at = ?
             WHERE id = ?`,
          )
          .run(nextStatus, timestamp, message.id);
        this.#appendEvent(
          nextStatus === "dead-letter"
            ? "instruction.dead-lettered"
            : "instruction.retry.queued",
          message.projectId,
          "daemon",
          "mailbox-reconciler",
          {
            messageId: message.id,
            slug: message.projectSlug,
            attempts: message.attempts,
          },
          timestamp,
        );
      }
      this.#database.exec("COMMIT");
      return rows.length;
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  reportFirstMateStatus(rawStatus: FirstMateStatus): FirstMateStatus {
    const status = validateFirstMateStatus(rawStatus);
    const project = this.getProject(status.projectSlug);
    if (!project) {
      throw new Error(`Unknown project: ${status.projectSlug}`);
    }
    const timestamp = this.#now().toISOString();
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      this.#database
        .prepare(
          `INSERT INTO firstmate_status(
            project_id, payload_json, reported_at, updated_at
          ) VALUES (?, ?, ?, ?)
          ON CONFLICT(project_id) DO UPDATE SET
            payload_json = excluded.payload_json,
            reported_at = excluded.reported_at,
            updated_at = excluded.updated_at`,
        )
        .run(
          project.id,
          JSON.stringify(status),
          status.timestamp,
          timestamp,
        );
      this.#database
        .prepare(
          `UPDATE projects
           SET actual_state = ?, current_summary = ?, attention_level = ?,
               last_heartbeat_at = ?, version = version + 1, updated_at = ?
           WHERE id = ?`,
        )
        .run(
          status.state,
          status.activity,
          status.attention,
          status.timestamp,
          timestamp,
          project.id,
        );
      this.#appendEvent(
        "firstmate.status.reported",
        project.id,
        "daemon",
        `firstmate:${project.slug}`,
        {
          slug: project.slug,
          state: status.state,
          activity: status.activity,
          iteration: status.iteration,
          safeToInterrupt: status.safeToInterrupt,
          checkpointId: status.checkpointId,
        },
        timestamp,
      );
      this.#database.exec("COMMIT");
      return status;
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  createCheckpoint(rawInput: unknown): Checkpoint {
    const input = validateCheckpointInput(rawInput);
    const project = this.getProject(input.projectSlug);
    if (!project) {
      throw new Error(`Unknown project: ${input.projectSlug}`);
    }
    const timestamp = this.#now().toISOString();
    const checkpoint: Checkpoint = {
      id: this.#createId("chk"),
      projectId: project.id,
      ...input,
      createdAt: timestamp,
    };
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      this.#database
        .prepare(
          `INSERT INTO checkpoints(id, project_id, payload_json, created_at)
           VALUES (?, ?, ?, ?)`,
        )
        .run(
          checkpoint.id,
          checkpoint.projectId,
          JSON.stringify(checkpoint),
          checkpoint.createdAt,
        );
      this.#appendEvent(
        "checkpoint.created",
        project.id,
        "daemon",
        `firstmate:${project.slug}`,
        {
          checkpointId: checkpoint.id,
          slug: project.slug,
          goal: checkpoint.goal,
          phase: checkpoint.phase,
          nextSafeAction: checkpoint.nextSafeAction,
        },
        timestamp,
      );
      this.#database.exec("COMMIT");
      return checkpoint;
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  createTimer(rawInput: unknown, rawIdempotencyKey: string): Timer {
    const input = validateCreateTimerInput(rawInput);
    const idempotencyKey = validateIdempotencyKey(rawIdempotencyKey);
    const replay = this.#database
      .prepare(
        "SELECT response_json FROM command_results WHERE idempotency_key = ?",
      )
      .get(idempotencyKey) as SqlRow | undefined;
    if (replay) {
      return JSON.parse(text(replay, "response_json")) as Timer;
    }
    const project = this.getProject(input.projectSlug);
    if (!project) {
      throw new Error(`Unknown project: ${input.projectSlug}`);
    }
    const timestamp = this.#now().toISOString();
    const timer: Timer = {
      id: this.#createId("tmr"),
      projectId: project.id,
      projectSlug: project.slug,
      dueAt: input.dueAt,
      text: input.text,
      priority: input.priority,
      status: "pending",
      firedMessageId: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      this.#database
        .prepare(
          `INSERT INTO timers(
            id, project_id, due_at, text, priority, status,
            fired_message_id, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          timer.id,
          timer.projectId,
          timer.dueAt,
          timer.text,
          timer.priority,
          timer.status,
          null,
          timer.createdAt,
          timer.updatedAt,
        );
      this.#appendEvent(
        "timer.created",
        timer.projectId,
        "user",
        "local-user",
        {
          timerId: timer.id,
          slug: timer.projectSlug,
          dueAt: timer.dueAt,
          priority: timer.priority,
        },
        timestamp,
        idempotencyKey,
      );
      this.#database
        .prepare(
          `INSERT INTO command_results(
            idempotency_key, command_type, response_json, created_at
          ) VALUES (?, ?, ?, ?)`,
        )
        .run(
          idempotencyKey,
          "timer.create",
          JSON.stringify(timer),
          timestamp,
        );
      this.#database.exec("COMMIT");
      return timer;
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  listTimers(rawProjectSlug?: string, limit = 100): readonly Timer[] {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
      throw new Error("Invalid timer query limit");
    }
    const rows = rawProjectSlug
      ? (this.#database
          .prepare(
            `SELECT t.*, p.slug AS project_slug
             FROM timers t JOIN projects p ON p.id = t.project_id
             WHERE p.slug = ? ORDER BY t.due_at LIMIT ?`,
          )
          .all(validateProjectSlug(rawProjectSlug), limit) as SqlRow[])
      : (this.#database
          .prepare(
            `SELECT t.*, p.slug AS project_slug
             FROM timers t JOIN projects p ON p.id = t.project_id
             ORDER BY t.due_at LIMIT ?`,
          )
          .all(limit) as SqlRow[]);
    return rows.map(timerFromRow);
  }

  fireDueTimers(limit = 100): readonly Timer[] {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
      throw new Error("Invalid timer fire limit");
    }
    const timestamp = this.#now().toISOString();
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const dueRows = this.#database
        .prepare(
          `SELECT t.*, p.slug AS project_slug
           FROM timers t JOIN projects p ON p.id = t.project_id
           WHERE t.status = 'pending' AND t.due_at <= ?
           ORDER BY t.due_at LIMIT ?`,
        )
        .all(timestamp, limit) as SqlRow[];
      const fired: Timer[] = [];
      for (const row of dueRows) {
        const timer = timerFromRow(row);
        const messageId = this.#createId("msg");
        this.#database
          .prepare(
            `INSERT INTO messages(
              id, project_id, text, priority, status, lease_owner,
              lease_expires_at, attempts, acknowledgement, resolution,
              created_at, updated_at
            ) VALUES (?, ?, ?, ?, 'queued', NULL, NULL, 0, NULL, NULL, ?, ?)`,
          )
          .run(
            messageId,
            timer.projectId,
            timer.text,
            timer.priority,
            timestamp,
            timestamp,
          );
        this.#database
          .prepare(
            `UPDATE timers
             SET status = 'fired', fired_message_id = ?, updated_at = ?
             WHERE id = ? AND status = 'pending'`,
          )
          .run(messageId, timestamp, timer.id);
        this.#appendEvent(
          "timer.fired",
          timer.projectId,
          "daemon",
          "timer-scheduler",
          {
            timerId: timer.id,
            messageId,
            slug: timer.projectSlug,
            dueAt: timer.dueAt,
          },
          timestamp,
        );
        this.#appendEvent(
          "instruction.queued",
          timer.projectId,
          "system",
          `timer:${timer.id}`,
          {
            messageId,
            timerId: timer.id,
            slug: timer.projectSlug,
            priority: timer.priority,
            text: timer.text,
          },
          timestamp,
        );
        fired.push({
          ...timer,
          status: "fired",
          firedMessageId: messageId,
          updatedAt: timestamp,
        });
      }
      this.#database.exec("COMMIT");
      return fired;
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  ingestHook(rawInput: HookInput): EventRecord {
    const input = validateHookInput(rawInput);
    const replay = this.#database
      .prepare(
        `SELECT e.* FROM hook_receipts h
         JOIN events e ON e.id = h.event_id
         WHERE h.hook_id = ?`,
      )
      .get(input.hookId) as SqlRow | undefined;
    if (replay) {
      return eventFromRow(replay);
    }
    const project = this.getProject(input.projectSlug);
    if (!project) {
      throw new Error(`Unknown project: ${input.projectSlug}`);
    }
    const recordedAt = this.#now().toISOString();
    const eventId = this.#createId("evt");
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      this.#database
        .prepare(
          `INSERT INTO events(
            id, occurred_at, recorded_at, type, project_id, actor_kind,
            actor_id, correlation_id, causation_id, schema_version, payload_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          eventId,
          input.occurredAt,
          recordedAt,
          `hook.${input.eventType}`,
          project.id,
          "daemon",
          `firstmate:${project.slug}`,
          input.hookId,
          null,
          1,
          JSON.stringify({
            slug: project.slug,
            hookId: input.hookId,
            ...input.payload,
          }),
        );
      this.#database
        .prepare(
          `INSERT INTO hook_receipts(hook_id, event_id, received_at)
           VALUES (?, ?, ?)`,
        )
        .run(input.hookId, eventId, recordedAt);
      this.#database.exec("COMMIT");
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
    const row = this.#database
      .prepare("SELECT * FROM events WHERE id = ?")
      .get(eventId) as SqlRow;
    return eventFromRow(row);
  }

  recordDecision(
    rawInput: RecordDecisionInput,
    rawIdempotencyKey: string,
  ): Decision {
    const input = validateRecordDecisionInput(rawInput);
    const idempotencyKey = validateIdempotencyKey(rawIdempotencyKey);
    const replay = this.#database
      .prepare(
        "SELECT response_json FROM command_results WHERE idempotency_key = ?",
      )
      .get(idempotencyKey) as SqlRow | undefined;
    if (replay) {
      return JSON.parse(text(replay, "response_json")) as Decision;
    }
    const timestamp = this.#now().toISOString();
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const currentRow = this.#database
        .prepare(
          "SELECT * FROM decisions WHERE topic = ? AND status = 'active'",
        )
        .get(input.topic) as SqlRow | undefined;
      const current = currentRow ? decisionFromRow(currentRow) : null;
      const decision: Decision =
        current &&
        current.value === input.value &&
        current.summary === input.summary &&
        current.source === input.source
          ? current
          : {
              id: this.#createId("dec"),
              ...input,
              status: "active",
              supersedesId: current?.id ?? null,
              createdAt: timestamp,
              supersededAt: null,
            };
      if (decision !== current) {
        if (current) {
          this.#database
            .prepare(
              `UPDATE decisions SET status = 'superseded', superseded_at = ?
               WHERE id = ? AND status = 'active'`,
            )
            .run(timestamp, current.id);
        }
        this.#database
          .prepare(
            `INSERT INTO decisions(
              id, topic, value, summary, source, status, supersedes_id,
              created_at, superseded_at
            ) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, NULL)`,
          )
          .run(
            decision.id,
            decision.topic,
            decision.value,
            decision.summary,
            decision.source,
            decision.supersedesId,
            decision.createdAt,
          );
        this.#appendEvent(
          "decision.recorded",
          null,
          "user",
          "local-user",
          {
            decisionId: decision.id,
            topic: decision.topic,
            summary: decision.summary,
            source: decision.source,
            supersedesId: decision.supersedesId,
          },
          timestamp,
          idempotencyKey,
        );
      }
      this.#database
        .prepare(
          `INSERT INTO command_results(
            idempotency_key, command_type, response_json, created_at
          ) VALUES (?, ?, ?, ?)`,
        )
        .run(
          idempotencyKey,
          "decision.record",
          JSON.stringify(decision),
          timestamp,
        );
      this.#database.exec("COMMIT");
      return decision;
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  listDecisions(activeOnly = true): readonly Decision[] {
    const rows = this.#database
      .prepare(
        activeOnly
          ? `SELECT * FROM decisions
             WHERE status = 'active' ORDER BY topic`
          : `SELECT * FROM decisions ORDER BY topic, created_at`,
      )
      .all() as SqlRow[];
    return rows.map(decisionFromRow);
  }

  listEvents(after = 0, limit = 100): readonly EventRecord[] {
    if (
      !Number.isSafeInteger(after) ||
      after < 0 ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 500
    ) {
      throw new Error("Invalid event query bounds");
    }
    const rows = this.#database
      .prepare(
        "SELECT * FROM events WHERE sequence > ? ORDER BY sequence LIMIT ?",
      )
      .all(after, limit) as SqlRow[];
    return rows.map(eventFromRow);
  }
}
