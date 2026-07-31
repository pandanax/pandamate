# Generated CLI reference

<!-- GENERATED FILE. DO NOT EDIT. Run `pnpm docs:generate`. -->

Sources: `apps/cli/src/main.ts`.

This is the exact usage surface printed by the current CLI implementation.

```text
Usage:
  pandamate daemon start|stop|status
  pandamate status [--json]
  pandamate start|stop|restart|open|close-tab <project> [--json]
  pandamate shutdown-all [--timeout <seconds>] [--no-force] [--keep-windows] [--json]
  pandamate send <project> <instruction...> [--priority normal|high|urgent] [--json]
  pandamate inbox list [project] [--json]
  pandamate inbox lease <project> <owner> [--json]
  pandamate inbox ack|apply|resolve|fail <message-id> <owner> <summary...> [--json]
  pandamate timer add <project> <ISO-due-at> <instruction...> [--priority normal|high|urgent]
  pandamate timer list [project] [--json]
  pandamate event <project> <hook-id> <event-type> [payload-json]
  pandamate memory set <topic> <value> <summary> [source]
  pandamate memory list [--history] [--json]
  pandamate memory check [--json]
  pandamate project add <slug> <title> <arc|git|docs> <absolute-workspace>
  pandamate project create <FirstMateArc|FirstMateGit|DocResearch> <absolute-workspace> [title]
  pandamate project adopt <slug> <tmux-session> [--json]
  pandamate project show <slug> [--json]
  pandamate events [--after <sequence>] [--limit <count>] [--json]
  pandamate doctor [--json]
```
