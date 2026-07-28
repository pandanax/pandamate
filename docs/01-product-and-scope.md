# 01. Product and scope

## 1. Product statement

Pandamate is a terminal-native personal operations console. It supervises
multiple independent FirstMate orchestrators that work in Arcadia repositories,
Git repositories, or document workspaces.

The normal relationship is:

```text
Panda
└── Pandamate
    ├── FirstMateArc
    │   └── project workers
    ├── FirstMateGit
    │   └── project workers
    └── DocResearch
        └── conversational research session (notes, no workers)
```

Panda normally talks only to Pandamate. Direct entry into a FirstMate tmux
session is an escape hatch for diagnosis or fine steering.

## 2. Product principles

1. **External state is authoritative.** A Claude transcript is never the only
   copy of a decision, pending instruction, or recovery checkpoint.
2. **Home screen first.** Starting `pandamate` opens the current control deck,
   not a blank chat.
3. **Thin control plane.** Pandamate does not duplicate a project plan already
   owned by its FirstMate.
4. **Fresh context by default.** Long-lived identity comes from durable memory,
   not an endlessly resumed conversation.
5. **Observable actions.** Every routed instruction and lifecycle transition is
   visible in the activity timeline.
6. **Safe recovery.** Desired state is restored automatically when safe;
   ambiguous external side effects require reconciliation.
7. **Fast without AI.** Listing projects, opening tmux, reading statuses, and
   recovery do not require a model call.
8. **Progressive detail.** The home screen stays quiet; raw logs and transcripts
   are available on demand.
9. **Local first.** The initial system exposes no network service and does not
   require a browser.

## 3. Primary user journeys

### 3.1 Open the control deck

Pandamate immediately shows:

- running, waiting, sleeping, failed, and stopped FirstMates;
- work summaries and heartbeat age;
- items requiring Panda’s attention;
- recent activity;
- a command/chat input.

### 3.2 Start a project

Panda chooses a workspace and FirstMate kind. Pandamate validates the launch
profile, creates a stable tmux session, starts the FirstMate, receives its first
heartbeat, then marks it running.

### 3.3 Give an instruction

Panda writes natural language to Pandamate. Pandamate identifies the target,
stores the instruction, routes it to the target inbox, tracks acknowledgement
and application, and reports only meaningful changes.

### 3.4 Inspect or intervene

Panda selects a FirstMate and can:

- view its status and message history;
- send a normal or urgent instruction;
- open its tmux session;
- pause, resume, restart, or stop it;
- request a fresh summary;
- inspect errors and recovery state.

### 3.5 Recover after interruption

After power loss or process death, Pandamate:

1. loads durable state;
2. inspects actual tmux sessions and processes;
3. reconciles desired and actual states;
4. recreates safe sessions;
5. verifies interrupted operations before retrying;
6. displays a recovery report.

### 3.6 Change Pandamate itself

When Panda changes a behavior, preference, interface rule, or architecture
decision, Pandamate records the source message and updates the authoritative
memory before acknowledging the change. Superseded values remain in history but
do not remain active.

## 4. FirstMate types

The first release supports three profiles:

| Kind | Workspace | VCS assumptions | Typical work |
|---|---|---|---|
| `arc` | Arcadia | `arc`, Arcadia worktrees and tools | engineering tasks |
| `git` | Git repository | Git worktree/branch conventions | pet and public projects |
| `docs` / `DocResearch` | directory or document set | none required | legal, research, writing |

Profiles define launch and capability policy. They do not fork the core runtime.
The two code profiles launch as supervising FirstMates that own durable work and
dispatch workers; `DocResearch` instead launches as a light research partner — a
conversational session that opens by asking the captain to scope the research and
captures durable findings as written notes ([D-030](08-decisions.md)).

## 5. MVP boundary

### Included

- local daemon and CLI;
- durable project registry and event log;
- tmux launch/open/stop/restart;
- hook ingestion and heartbeat monitoring;
- durable inbox/outbox with acknowledgement;
- a rich TUI home screen and detail screens;
- conversational routing through Claude Agent SDK;
- Markdown semantic memory;
- crash and reboot recovery;
- Arc, Git, and Docs launch profiles;
- structured diagnostics and exportable support bundle.

### Explicitly deferred

- remote access or multi-user mode;
- web dashboard;
- mobile client;
- cloud synchronization;
- arbitrary nested orchestration visibility;
- billing/cost optimization across providers;
- replacing the native Claude Code interactive UI;
- general workflow-builder UI;
- plugin marketplace.

## 6. Success measures

- Control deck becomes usable in under 500 ms when the daemon is already up.
- Non-AI navigation responds in under 100 ms at p95.
- No acknowledged instruction or decision is lost in forced-kill tests.
- A previously running safe FirstMate is restored after reboot simulation.
- The home briefing remains bounded regardless of event-history size.
- Panda can determine “who is doing what and who needs me” without opening a
  FirstMate.
- Every direct tmux transition has a clear way back to Pandamate.
