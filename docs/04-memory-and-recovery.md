# 04. Memory and recovery

## 1. Memory hierarchy

### Implemented slice — 2026-07-31

SQLite migration 7 stores bounded decisions with one active value per topic and
immutable supersession history. The daemon materializes all active decisions
into one mode-0600 `memory/MEMORY.md` at startup and after `decision.record`;
`pandamate memory list --history` exposes history and `pandamate memory check`
compares the generated content checksum with disk.

The hierarchy below is the target layout. Only `MEMORY.md` exists today;
identity/preferences/product/project/decision/playbook topic files, a bounded
index over those files, and reviewed import/reconciliation are not implemented.

```text
state.sqlite3                   operational source of truth
memory/
├── MEMORY.md                  bounded index loaded into brain episodes
├── identity.md                stable role and relationship
├── preferences.md             current Panda preferences
├── product.md                 current Pandamate behavior and UX rules
├── projects/
│   └── <slug>.md              one current semantic summary per project
├── decisions/
│   └── <topic>.md             current decision plus history links
└── playbooks/
    └── *.md                   reusable recovery/operation knowledge
CLAUDE.md                      concise non-negotiable operating contract
.claude/skills/                procedures loaded only when relevant
```

These paths are relative to Pandamate's local application state directory, not
to a synchronized project workspace. The implementation repository may contain
templates, but live memory is user state and is backed up separately.

`CLAUDE.md` is not a database. It must contain only rules needed in every brain
episode and target fewer than 200 lines.

`MEMORY.md` is an index, not a diary. It targets fewer than 200 lines and 25 KB.
Topic files are loaded on demand.

## 2. Memory write protocol

The target write protocol when Panda communicates a durable correction or
decision is:

1. record the source message event;
2. let the brain propose a typed memory mutation;
3. validate scope, topic key, and evidence;
4. transact the new decision and supersede the previous value;
5. atomically materialize the relevant Markdown;
6. record `memory.updated`;
7. only then acknowledge “remembered”.

Today the deterministic CLI/IPC path starts at step 3: `pandamate memory set`
validates and transactionally records the decision and its audit event, then the
daemon atomically regenerates `MEMORY.md`. The brain has no mutation tools, so
steps 1–3 as a conversational workflow and a distinct `memory.updated` event are
not implemented. The model never directly edits authoritative memory.

## 3. What deserves memory

Persist:

- explicit preferences and corrections;
- accepted architecture/product decisions;
- project facts required after restart;
- reusable failure and recovery knowledge;
- promises and pending obligations;
- rationale that would otherwise be repeatedly rediscovered.

Do not persist:

- transient chain of thought;
- raw tool output;
- every conversational sentence;
- facts cheaply rediscoverable from current state;
- speculative proposals not accepted by Panda.

## 4. Freshness and conflict handling

Each memory topic has one active value. New values explicitly supersede old
ones. The current generated `MEMORY.md` shows topic, summary, value, source,
decision ID, and recorded timestamp. The richer target materialization shows:

- current decision first;
- effective and modified timestamps;
- provenance link to event/decision IDs;
- short rationale;
- superseded history only as references.

Current consistency checking compares the complete generated content checksum
and relies on the SQLite unique index for one active decision per topic. Target
maintenance additionally checks:

- DB decision matches Markdown checksum;
- every active topic has one active record;
- no unresolved contradictory topic keys;
- index points only to existing files;
- timestamps and project summaries are not silently stale.

If DB and Markdown disagree, the database event history is authoritative. A
daemon restart regenerates Markdown; `memory check` only reports drift and does
not repair it. Manual Markdown import through a reviewed `memory reconcile` flow
is not implemented.

## 5. Brain episode lifecycle

Pandamate identity is continuous; its Claude context is not. The implemented
slice builds a JSON briefing capped at 12,000 characters from at most 100
projects, 100 active decisions, 50 unresolved messages, and 100 recent events.
It resumes one SDK session, enforces a 45-second deadline and USD 0.25 per-call
budget, and rotates after 20 successful turns. Durable episode/session records,
context telemetry, retrieval tools, and end-of-episode summaries remain target
work.

### Start

Build a bounded briefing:

- identity and operating contract;
- active projects requiring attention;
- recent material changes;
- unresolved instructions/decisions;
- current user request;
- links to relevant memory, not their entire contents.

### During

- fetch project/event slices only through bounded tools;
- delegate large searches or reads to isolated subagents;
- record accepted durable changes immediately;
- monitor context budget.

### End/rotation

- resolve or checkpoint the current instruction;
- persist newly accepted decisions;
- produce a concise episode summary;
- record session replacement link;
- start fresh rather than repeatedly compacting unrelated work.

Compaction is an emergency/continuity mechanism, not the persistence layer.

## 6. Checkpoint policy

FirstMates checkpoint:

- before and after external side effects;
- after completing a plan step;
- before applying a high-priority instruction;
- before voluntary stop or context rotation;
- periodically during long tool runs when possible.

Checkpoints must describe observable state, not merely “continue working”.

## 7. Recovery algorithm

The daemon currently acquires the lock, opens/migrates SQLite, replays the hook
spool on a one-second loop, retries expired mailbox leases, observes tmux, and
recreates missing desired-running sessions. It does not yet persist an
operation-recovery journal, classify ambiguous side effects, resume/replace
brain sessions after process loss, or publish a startup recovery report.

The complete target algorithm is:

On daemon startup:

1. acquire a single-instance lock;
2. open SQLite and run integrity/migration checks;
3. import hook spool files transactionally;
4. expire abandoned leases;
5. enumerate tmux sessions and known PIDs;
6. calculate actual state for every project;
7. compare with desired state;
8. classify interrupted operations;
9. restart safe launch profiles;
10. verify ambiguous side effects before retry;
11. resume or replace Claude sessions;
12. publish one recovery report.

## 8. Recovery classes

| Class | Example | Policy |
|---|---|---|
| Safe repeat | status query, heartbeat | retry automatically |
| Idempotent with key | inbox delivery | retry automatically |
| Reconcile first | commit, document write | inspect result, then continue |
| Human approval | message to person, destructive action | request attention |
| Non-resumable | corrupted workspace | stop and provide diagnosis |

Previously running FirstMates have `desired_state=running` and restart
automatically unless the interrupted step belongs to the last two classes.

## 9. Power-loss durability

The first mechanisms below exist in partial form: SQLite WAL/transactions,
atomic Markdown/spool rename, and acknowledgement only after the DB transaction.
Directory fsync, backup policy/drills, and pre-migration backup are not
implemented. The complete target guarantees are:

- SQLite WAL with transactions and deliberate synchronous policy;
- atomic write-to-temp plus rename for Markdown;
- spool writes followed by directory sync where the platform supports it;
- no acknowledgement before durable commit;
- database backups and restore drills;
- migrations are forward-only with pre-migration backup;
- event and semantic-memory exports remain human readable.

## 10. Startup briefing

After recovery, the home screen displays a short report:

```text
Pandamate recovered
3 FirstMates restored
1 operation reconciled successfully
1 project requires attention
Last durable event: 14:42:18
Memory consistency: OK
```

The report is generated from recovery events, not model recollection.
