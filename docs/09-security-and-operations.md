# 09. Security and operations

## 1. Trust boundary

Pandamate controls shells, repositories, documents, and agent sessions under one
local user account. That makes its local socket, configuration, hooks, and
message bus security-sensitive even without a network listener.

MVP assumptions:

- one trusted OS user;
- no remote clients;
- FirstMate project content may be untrusted;
- model output and hook payloads are untrusted input;
- Arc, Git, and Docs adapters have different allowed capabilities.

## 2. Required controls

- State directory and socket are accessible only to the owning user.
- Live database, WAL, and memory are kept off synchronized/network filesystems.
- Canonical workspace paths are registered explicitly.
- Project IDs, paths, tmux names, and messages are never interpolated into shell
  command strings.
- Processes launch through argument arrays and versioned launch profiles.
- Adoption rejects `pandamate:*`, requires live-pane evidence, resolves a stable
  session ID, and enforces one project per target.
- Every IPC and hook payload is size-limited and schema-validated.
- Mutations require an idempotency key and are audited.
- Dangerous lifecycle actions require explicit confirmation unless covered by a
  recorded policy.
- Secrets never appear in events, semantic memory, status summaries, or support
  bundles.
- FirstMate permissions follow least privilege per profile.
- Pandamate never enables Claude Code permission bypass globally.

## 3. Hook safety

Hooks must:

- complete quickly and avoid model/network dependencies;
- spool when the daemon is unavailable;
- redact configured secret patterns before persistence;
- preserve enough metadata for correlation;
- tolerate duplicate and out-of-order delivery;
- never block Claude work merely because telemetry failed, except for a
  separately reviewed policy hook.

Telemetry hooks and enforcement hooks are separate configurations.

## 4. Data classes and retention

| Data | Default handling |
|---|---|
| decisions/preferences | retain until explicitly superseded/removed |
| project summaries | retain current plus change history |
| operational events | retain with configurable compaction window |
| raw hook payloads | short retention |
| Claude transcripts | owned by Claude Code retention settings |
| secrets | never intentionally persist |
| backups | encrypted or protected by OS user permissions |

Retention maintenance emits an audit event and never deletes active decisions,
pending instructions, current checkpoints, or unresolved recovery evidence.

## 5. Permissions and confirmation

Each command is classified:

- **read-only:** status, logs, memory inspection;
- **reversible:** start, pause, normal message;
- **important:** restart during work, urgent interruption;
- **dangerous/external:** destructive commands or communication to people.

The daemon enforces policy independently of model wording. A Claude brain may
recommend an action but cannot bypass confirmation rules.

## 6. Observability

Provide:

- structured rotating daemon logs;
- event-store sequence and lag metrics;
- hook spool and dead-letter counts;
- timer backlog and oldest overdue timer;
- per-project heartbeat age;
- process restart counts;
- brain episode context/turn usage when available;
- database/WAL size and last successful backup;
- memory consistency status.

The Diagnostics screen links every warning to an actionable remediation.

## 7. Installation and lifecycle

The hardened release supplies:

- `pandamate daemon install` for launch at login;
- deterministic state/config/log locations;
- health check and version output;
- graceful shutdown with bounded deadline;
- database backup before migration;
- rollback that does not downgrade the database destructively;
- `pandamate doctor --fix` only for safe, disclosed repairs;
- `pandamate support-bundle` with mandatory redaction preview.

## 8. Upgrade compatibility

- pin Claude Agent SDK and TUI versions;
- record detected Claude Code version in session events;
- version external hook adapters and internal payloads independently;
- accept additive unknown fields;
- gate incompatible upgrades with a migration preflight;
- retain the prior application version until post-upgrade health succeeds.

## 9. Operational runbooks

Before 1.0, document and test:

- daemon will not start;
- socket is stale;
- database integrity failure;
- hook spool grows;
- tmux target exists but process is dead;
- FirstMate heartbeat is stale;
- Claude authentication/network unavailable;
- memory DB and Markdown disagree;
- upgrade failed;
- restore from backup.
