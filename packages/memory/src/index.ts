import { createHash } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import type { Decision } from "@pandamate/domain";

export interface MemoryMaterialization {
  readonly path: string;
  readonly checksum: string;
  readonly bytes: number;
  readonly decisionCount: number;
}

export function renderMemoryIndex(
  decisions: readonly Decision[],
): string {
  const active = decisions
    .filter((decision) => decision.status === "active")
    .sort((left, right) => left.topic.localeCompare(right.topic));
  const sections = active.map(
    (decision) => `## ${decision.topic}

${decision.summary}

Value:

${decision.value}

Source: ${decision.source}
Decision: ${decision.id}
Recorded: ${decision.createdAt}
`,
  );
  return `# Pandamate memory

This file is generated from durable active decisions. Edit decisions through
Pandamate; direct edits are reported as consistency drift.

${sections.join("\n")}`.trimEnd() + "\n";
}

export class MemoryMaterializer {
  readonly #directory: string;

  constructor(directory: string) {
    if (!directory.startsWith("/") || directory.includes("\0")) {
      throw new Error("Memory directory must be absolute");
    }
    this.#directory = directory;
  }

  get indexPath(): string {
    return join(this.#directory, "MEMORY.md");
  }

  materialize(decisions: readonly Decision[]): MemoryMaterialization {
    mkdirSync(this.#directory, { recursive: true, mode: 0o700 });
    const content = renderMemoryIndex(decisions);
    const temporary = `${this.indexPath}.${process.pid}.tmp`;
    writeFileSync(temporary, content, { encoding: "utf8", mode: 0o600 });
    renameSync(temporary, this.indexPath);
    return {
      path: this.indexPath,
      checksum: createHash("sha256").update(content).digest("hex"),
      bytes: Buffer.byteLength(content),
      decisionCount: decisions.filter(
        (decision) => decision.status === "active",
      ).length,
    };
  }

  check(decisions: readonly Decision[]): {
    readonly ok: boolean;
    readonly expectedChecksum: string;
    readonly actualChecksum: string | null;
  } {
    const expected = renderMemoryIndex(decisions);
    const expectedChecksum = createHash("sha256")
      .update(expected)
      .digest("hex");
    let actual: string;
    try {
      actual = readFileSync(this.indexPath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { ok: false, expectedChecksum, actualChecksum: null };
      }
      throw error;
    }
    const actualChecksum = createHash("sha256")
      .update(actual)
      .digest("hex");
    return {
      ok: actual === expected,
      expectedChecksum,
      actualChecksum,
    };
  }
}
