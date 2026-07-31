import type { EventRecord, Project } from "@pandamate/domain";

export function formatProjects(projects: readonly Project[]): string {
  if (projects.length === 0) {
    return "No registered projects.\n";
  }
  const lines = ["PROJECT             KIND   MERGE    DESIRED   ACTUAL       WORKSPACE"];
  for (const project of projects) {
    lines.push(
      `${project.slug.padEnd(19)} ${project.kind.padEnd(6)} ${project.mergeMode.padEnd(8)} ${project.desiredState.padEnd(9)} ${project.actualState.padEnd(12)} ${project.workspace}`,
    );
  }
  return `${lines.join("\n")}\n`;
}

export function formatEvents(events: readonly EventRecord[]): string {
  if (events.length === 0) {
    return "No events recorded.\n";
  }
  return `${events
    .map(
      (event) =>
        `${String(event.sequence).padStart(6)}  ${event.recordedAt}  ${event.type.padEnd(24)} ${event.projectId ?? "system"}`,
    )
    .join("\n")}\n`;
}
