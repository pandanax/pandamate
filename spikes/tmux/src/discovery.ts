import type {
  ProjectSummary,
  ServiceSummary,
} from "../../tui/src/model.ts";

import {
  crewHostProjectSlug,
  isPandamateControlSession,
  type DiscoveredTmuxSession,
} from "@pandamate/runtime-tmux";
import {
  profileForProjectKind,
  type Project,
} from "@pandamate/domain";
import { firstMateWorkspaceEvidence } from "@pandamate/firstmate-kit";

export { discoverTmuxSessions } from "@pandamate/runtime-tmux";

/**
 * Turn discovered non-control tmux sessions into standalone Fleet items — but
 * not the ones that only host another project's crew. A session whose windows
 * are `fm-<slug>-<task>` of a registered project (the bare `firstmate` crew
 * session is the canonical case) belongs to `<slug>`, not to itself, so it is
 * folded into that project rather than shown as a separate nameless FirstMate.
 * `knownSlugs` is the set of registered project slugs; with none passed, every
 * non-control session is standalone exactly as before.
 */
export function projectSummariesFromTmux(
  sessions: readonly DiscoveredTmuxSession[],
  knownSlugs: ReadonlySet<string> = new Set(),
): readonly ProjectSummary[] {
  const isKnownSlug = (slug: string): boolean => knownSlugs.has(slug);
  return sessions
    .filter((session) => !isPandamateControlSession(session.name))
    .filter((session) => crewHostProjectSlug(session, isKnownSlug) === null)
    .map((session) => {
    const commands =
      session.commands.length === 0 ? "no commands" : session.commands.join(", ");
    const attachment =
      session.attachedClients > 0
        ? ` · ${session.attachedClients} attached`
        : "";
    return {
      name: session.name,
      // A discovered session is not a durable project: Pandamate never
      // registered it, so it has no slug to be started again by.
      slug: null,
      profile: null,
      sessionName: session.name,
      state: session.livePaneCount > 0 ? "running" : "stopped",
      summary: `${session.windowCount} windows · ${session.livePaneCount} live panes${attachment} · ${commands}`,
      lastMessage: null,
      heartbeatSeconds: null,
      tmuxWindowCount: session.windowCount,
    };
    });
}

export function serviceSummariesFromTmux(
  sessions: readonly DiscoveredTmuxSession[],
): readonly ServiceSummary[] {
  return sessions
    .filter((session) => isPandamateControlSession(session.name))
    .map((session) => ({
      name: session.name,
      state: session.livePaneCount > 0 ? "running" : "stopped",
      summary: `${session.windowCount} windows · ${session.livePaneCount} live panes · ${session.attachedClients} attached`,
    }));
}

export function projectSummariesFromDaemon(
  projects: readonly Project[],
  now = new Date(),
  sessions: readonly DiscoveredTmuxSession[] = [],
): readonly ProjectSummary[] {
  return projects.map((project) => {
    const evidence = firstMateWorkspaceEvidence(project.workspace);
    const heartbeatAt = evidence.heartbeatAt ?? project.lastHeartbeatAt;
    const runtime = sessions.find(
      (session) =>
        session.id === project.tmuxTarget ||
        session.name === project.tmuxSessionName,
    );
    return {
      name: project.title,
      slug: project.slug,
      profile: profileForProjectKind(project.kind),
      sessionName:
        project.tmuxTarget === null ? null : project.tmuxSessionName,
      state: project.actualState,
      summary:
        evidence.lastAssistantMessage ??
        evidence.latestStatus ??
        project.currentSummary,
      lastMessage:
        evidence.lastAssistantMessage ?? evidence.latestStatus,
      heartbeatSeconds:
        heartbeatAt === null
          ? null
          : Math.max(
              0,
              Math.floor(
                (now.getTime() - Date.parse(heartbeatAt)) / 1000,
              ),
            ),
      tmuxWindowCount: runtime?.windowCount ?? null,
    };
  });
}
