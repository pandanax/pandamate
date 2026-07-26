# 04. Memory and recovery

## 1. Memory hierarchy

```text
state/pandamate.db              operational source of truth
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

When Panda communicates a durable correction or decision:

1. record the source message event;
2. let the brain propose a typed memory mutation;
3. validate scope, topic key, and evidence;
4. transact the new decision and supersede the previous value;
5. atomically materialize the relevant Markdown;
6. record `memory.updated`;
7. only then acknowledge “remembered”.

The model never directly edits authoritative memory. Its proposed mutation is
validated and applied by deterministic code.

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
ones. Materialized Markdown shows:

- current decision first;
- effective and modified timestamps;
- provenance link to event/decision IDs;
- short rationale;
- superseded history only as references.

Consistency maintenance checks:

- DB decision matches Markdown checksum;
- every active topic has one active record;
- no unresolved contradictory topic keys;
- index points only to existing files;
- timestamps and project summaries are not silently stale.

If DB and Markdown disagree, the database event history is authoritative and the
Markdown is regenerated. Manual Markdown edits are imported only through a
reviewed `memory reconcile` flow.

## 5. Brain episode lifecycle

Pandamate identity is continuous; its Claude context is not.

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
