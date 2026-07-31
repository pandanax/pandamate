# Generated workspace reference

<!-- GENERATED FILE. DO NOT EDIT. Run `pnpm docs:generate`. -->

Sources: `package.json`, `pnpm-workspace.yaml`, `apps/*/package.json`, `packages/*/package.json`, `spikes/*/package.json`, `fixtures/*/package.json`.

## Root commands

| Command | Implementation |
|---|---|
| `pnpm check` | `pnpm -r check && pnpm docs:check` |
| `pnpm daemon` | `pnpm --filter @pandamate/daemon start` |
| `pnpm docs:check` | `tsc -p scripts/docs/tsconfig.json && node scripts/docs/generate.ts --check` |
| `pnpm docs:generate` | `node scripts/docs/generate.ts` |
| `pnpm pandamate` | `pnpm --filter @pandamate/cli start --` |
| `pnpm spike:tmux` | `pnpm --filter @pandamate/spike-tmux smoke` |
| `pnpm spike:tmux:navigation` | `pnpm --filter @pandamate/spike-tmux smoke:navigation` |
| `pnpm spike:tmux:tui` | `pnpm --filter @pandamate/spike-tmux smoke:tui` |
| `pnpm spike:tui` | `pnpm --filter @pandamate/spike-tui start` |
| `pnpm spike:tui:discovered` | `pnpm --filter @pandamate/spike-tmux tui:discovered` |
| `pnpm spike:tui:idle` | `pnpm --filter @pandamate/spike-tmux probe:idle` |
| `pnpm test` | `pnpm -r test` |
| `pnpm verify` | `pnpm check && pnpm test` |

## Workspace packages

| Path | Package | Binaries | Scripts | Workspace dependencies |
|---|---|---|---|---|
| `apps/cli` | `@pandamate/cli` | pandamate | check, start, test | @pandamate/client, @pandamate/config, @pandamate/domain, @pandamate/firstmate-kit, @pandamate/protocol, @pandamate/runtime-tmux |
| `apps/daemon` | `@pandamate/daemon` | — | check, start, test | @pandamate/client, @pandamate/config, @pandamate/domain, @pandamate/firstmate-kit, @pandamate/memory, @pandamate/protocol, @pandamate/runtime-tmux, @pandamate/storage |
| `fixtures/fake-firstmate` | `@pandamate/fake-firstmate` | — | check, start, test | @pandamate/domain, @pandamate/firstmate-kit |
| `packages/agent-sdk` | `@pandamate/agent-sdk` | — | check, test | @pandamate/domain |
| `packages/client` | `@pandamate/client` | — | check, test | @pandamate/protocol |
| `packages/config` | `@pandamate/config` | — | check, test | — |
| `packages/domain` | `@pandamate/domain` | — | check, test | — |
| `packages/firstmate-kit` | `@pandamate/firstmate-kit` | pandamate-hook | check, test | @pandamate/client, @pandamate/domain, @pandamate/protocol |
| `packages/memory` | `@pandamate/memory` | — | check, test | @pandamate/domain |
| `packages/protocol` | `@pandamate/protocol` | — | check, test | @pandamate/domain |
| `packages/runtime-tmux` | `@pandamate/runtime-tmux` | — | check, test | — |
| `packages/storage` | `@pandamate/storage` | — | check, test | @pandamate/domain |
| `spikes/tmux` | `@pandamate/spike-tmux` | — | check, probe:idle, smoke, smoke:navigation, smoke:tui, test, tui:discovered | @pandamate/agent-sdk, @pandamate/client, @pandamate/config, @pandamate/domain, @pandamate/firstmate-kit, @pandamate/protocol, @pandamate/runtime-tmux |
| `spikes/tui` | `@pandamate/spike-tui` | — | check, start, test | — |

## Runtime environment variables

This inventory includes production and spike sources, but excludes test-only use.

| Variable | Referenced by |
|---|---|
| `PANDAMATE_CLAUDE_EXECUTABLE` | `packages/config/src/index.ts` |
| `PANDAMATE_EVENTS_JSON` | `spikes/tmux/src/launch-tui.ts`<br>`spikes/tmux/src/tui-smoke.ts`<br>`spikes/tui/src/index.ts`<br>`spikes/tui/src/model.ts` |
| `PANDAMATE_FAKE_FIRSTMATE_ENTRY` | `packages/config/src/index.ts` |
| `PANDAMATE_FIRSTMATE_ADAPTER` | `packages/config/src/index.ts` |
| `PANDAMATE_FIRSTMATE_HOME` | `apps/daemon/src/supervisor.ts`<br>`packages/config/src/index.ts`<br>`packages/firstmate-kit/src/index.ts` |
| `PANDAMATE_HEARTBEAT_STALE_MS` | `packages/config/src/index.ts` |
| `PANDAMATE_HOOK_SPOOL_DIR` | `apps/daemon/src/supervisor.ts`<br>`packages/firstmate-kit/src/hook-cli.ts` |
| `PANDAMATE_NODE` | `spikes/tmux/src/idle-probe.ts`<br>`spikes/tmux/src/tui-smoke.ts` |
| `PANDAMATE_PROJECT_SLUG` | `apps/daemon/src/supervisor.ts`<br>`packages/firstmate-kit/src/hook-cli.ts` |
| `PANDAMATE_PROJECTS_JSON` | `spikes/tmux/src/launch-tui.ts`<br>`spikes/tui/src/index.ts`<br>`spikes/tui/src/model.ts` |
| `PANDAMATE_RECONCILE_INTERVAL_MS` | `packages/config/src/index.ts` |
| `PANDAMATE_REDUCED_MOTION` | `spikes/tui/src/index.ts` |
| `PANDAMATE_RUNTIME_DIR` | `packages/config/src/index.ts` |
| `PANDAMATE_SERVICES_JSON` | `spikes/tmux/src/launch-tui.ts`<br>`spikes/tui/src/index.ts`<br>`spikes/tui/src/model.ts` |
| `PANDAMATE_SHUTDOWN_GRACE_MS` | `packages/config/src/index.ts` |
| `PANDAMATE_SOCKET_PATH` | `apps/daemon/src/supervisor.ts`<br>`packages/firstmate-kit/src/hook-cli.ts` |
| `PANDAMATE_STATE_DIR` | `packages/config/src/index.ts` |
| `PANDAMATE_TMUX_SESSION` | `apps/daemon/src/supervisor.ts`<br>`packages/runtime-tmux/src/index.ts` |
| `PANDAMATE_TMUX_SOCKET_NAME` | `packages/config/src/index.ts` |
| `PANDAMATE_TUI_CLEAN` | `spikes/tmux/src/tui-smoke.ts` |
| `PANDAMATE_TUI_ENTRY` | `spikes/tmux/src/idle-probe.ts`<br>`spikes/tmux/src/tui-smoke.ts` |
| `PANDAMATE_WATCHER_RESTART_BACKOFF_MS` | `packages/config/src/index.ts` |
