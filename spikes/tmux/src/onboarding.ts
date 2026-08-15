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
  const submittedName = basename(submittedPath);
  const workspace =
    submittedName === ".codex"
      ? dirname(submittedPath)
      : submittedPath;
  const codexConfigPath = join(workspace, ".codex", "config.toml");
  const agentsPath = join(workspace, "AGENTS.md");
  const settingsPath = existsSync(codexConfigPath)
    ? codexConfigPath
    : existsSync(agentsPath)
      ? agentsPath
      : null;
  if (!settingsPath) {
    throw new Error(
      `No FirstMate configuration found in ${workspace}. Name a profile explicitly.`,
    );
  }
  const settingsText = readFileSync(settingsPath, "utf8");
  const hasFirstMateMarker = /firstmate|FM_HOME|fm-[a-z]/i.test(settingsText);
  if (!hasFirstMateMarker) {
    throw new Error(
      `Agent settings in ${workspace} do not identify a FirstMate. Name a profile explicitly.`,
    );
  }
  if (existsSync(join(workspace, ".git"))) {
    return { profile: "FirstMateGit", workspace };
  }
  throw new Error(
    `FirstMate configuration found in ${workspace}, but its project profile is ambiguous.`,
  );
}
