import type {
  ProjectSummary,
  ServiceSummary,
} from "../../tui/src/model.ts";

import {
  crewHostProjectSlug,
  crewOfHostedSession,
  isPandamateControlSession,
  type DiscoveredTmuxSession,
  type HostedCrewmate,
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
 * folded into that project's row (its crewmates surface there as children, see
 * `hostedCrewByProjectSlug`) rather than shown as a separate nameless FirstMate.
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
      crew: [],
    };
    });
}

/**
 * The hosted crewmates each registered project owns, keyed by project slug,
 * gathered from the discovered sessions that are crew hosts. This is the inverse
 * of the drop in `projectSummariesFromTmux`: a crew session is left out of the
 * top-level Fleet there, and its crewmates reappear here as children of the
 * project row `projectSummariesFromDaemon` builds. A project with no crew host
 * simply has no entry. Crew from multiple hosting sessions of the same project
 * is merged and deduplicated by window, so the result is bounded and
 * deterministic.
 */
export function hostedCrewByProjectSlug(
  sessions: readonly DiscoveredTmuxSession[],
  knownSlugs: ReadonlySet<string> = new Set(),
): ReadonlyMap<string, readonly HostedCrewmate[]> {
  const isKnownSlug = (slug: string): boolean => knownSlugs.has(slug);
  const byWindow = new Map<string, Map<string, HostedCrewmate>>();
  for (const session of sessions) {
    if (isPandamateControlSession(session.name)) {
      continue;
    }
    const slug = crewHostProjectSlug(session, isKnownSlug);
    if (slug === null) {
      continue;
    }
    const windows = byWindow.get(slug) ?? new Map<string, HostedCrewmate>();
    for (const crewmate of crewOfHostedSession(session, slug, isKnownSlug)) {
      windows.set(crewmate.window, crewmate);
    }
    byWindow.set(slug, windows);
  }
  const merged = new Map<string, readonly HostedCrewmate[]>();
  for (const [slug, windows] of byWindow) {
    merged.set(
      slug,
      [...windows.values()].sort((left, right) =>
        left.window.localeCompare(right.window),
      ),
    );
  }
  return merged;
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
  hostedCrew: ReadonlyMap<
    string,
    readonly HostedCrewmate[]
  > = new Map(),
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
      name: project.customDisplayName ?? project.title,
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
      // A crew session that only hosts this project's crew was dropped from the
      // standalone Fleet; its crewmates surface here as this project's children.
      crew: hostedCrew.get(project.slug) ?? [],
    };
  });
}
