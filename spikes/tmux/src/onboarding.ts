import {
  existsSync,
  readFileSync,
  statSync,
} from "node:fs";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  normalize,
} from "node:path";

import type { FirstMateProfile } from "@pandamate/domain";

export function pathOnlyInput(text: string): string | null {
  const trimmed = text.trim();
  const quoted = trimmed.match(/^(["'])(\/.+)\1$/s);
  const candidate = quoted?.[2] ?? (trimmed.startsWith("/") ? trimmed : null);
  return candidate && isAbsolute(candidate) ? normalize(candidate) : null;
}

export function configuredFirstMateProfile(
  submittedPath: string,
): {
  readonly profile: FirstMateProfile;
  readonly workspace: string;
} {
  if (!statSync(submittedPath).isDirectory()) {
    throw new Error(`Workspace is not a directory: ${submittedPath}`);
  }
  const workspace =
    basename(submittedPath) === ".claude"
      ? dirname(submittedPath)
      : submittedPath;
  const settingsPath = join(workspace, ".claude", "settings.json");
  if (!existsSync(settingsPath)) {
    throw new Error(
      `No FirstMate configuration found in ${join(workspace, ".claude")}. Name a profile explicitly.`,
    );
  }
  const settingsText = readFileSync(settingsPath, "utf8");
  let settings: unknown;
  try {
    settings = JSON.parse(settingsText);
  } catch {
    throw new Error(`Invalid Claude settings: ${settingsPath}`);
  }
  const settingsRecord =
    typeof settings === "object" && settings !== null
      ? (settings as Record<string, unknown>)
      : {};
  const environment =
    typeof settingsRecord.env === "object" && settingsRecord.env !== null
      ? (settingsRecord.env as Record<string, unknown>)
      : {};
  const hasFirstMateMarker =
    typeof environment.FM_HOME === "string" ||
    /firstmate|fm-[a-z]/i.test(settingsText);
  if (!hasFirstMateMarker) {
    throw new Error(
      `Claude settings in ${workspace} do not identify a FirstMate. Name a profile explicitly.`,
    );
  }
  if (
    existsSync(join(workspace, ".arc")) ||
    existsSync(join(workspace, "a.yaml"))
  ) {
    return { profile: "FirstMateArc", workspace };
  }
  if (existsSync(join(workspace, ".git"))) {
    return { profile: "FirstMateGit", workspace };
  }
  throw new Error(
    `FirstMate configuration found in ${workspace}, but its project profile is ambiguous.`,
  );
}
