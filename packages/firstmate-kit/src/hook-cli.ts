#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { HookSpoolClient } from "./index.ts";

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing ${name}`);
  }
  return value;
}

function boundedInput(): Record<string, unknown> {
  const bytes = readFileSync(0);
  if (bytes.byteLength > 256 * 1024) {
    throw new Error("Claude hook input exceeds 256 KiB");
  }
  const value = JSON.parse(bytes.toString("utf8")) as unknown;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Claude hook input must be an object");
  }
  return value as Record<string, unknown>;
}

function optionalString(
  input: Record<string, unknown>,
  field: string,
  maximum = 240,
): string | undefined {
  const value = input[field];
  return typeof value === "string" && value.length <= maximum
    ? value
    : undefined;
}

try {
  const input = boundedInput();
  const eventName =
    optionalString(input, "hook_event_name", 120) ?? "unknown";
  const stableSource = JSON.stringify({
    eventName,
    sessionId: optionalString(input, "session_id", 160),
    toolUseId: optionalString(input, "tool_use_id", 160),
    notificationType: optionalString(input, "notification_type", 120),
    stopHookActive: input.stop_hook_active === true,
    input,
  });
  const hookId = `claude:${createHash("sha256")
    .update(stableSource)
    .digest("hex")}`;
  const payload = {
    sessionId: optionalString(input, "session_id", 160),
    toolUseId: optionalString(input, "tool_use_id", 160),
    toolName: optionalString(input, "tool_name", 120),
    notificationType: optionalString(input, "notification_type", 120),
    stopHookActive: input.stop_hook_active === true,
  };
  const client = new HookSpoolClient({
    socketPath: requiredEnvironment("PANDAMATE_SOCKET_PATH"),
    spoolDirectory: requiredEnvironment("PANDAMATE_HOOK_SPOOL_DIR"),
  });
  await client.ingest({
    projectSlug: requiredEnvironment("PANDAMATE_PROJECT_SLUG"),
    hookId,
    eventType: eventName
      .replaceAll(/([a-z])([A-Z])/g, "$1.$2")
      .toLowerCase()
      .replaceAll(/[^a-z0-9_.-]+/g, "-")
      .replaceAll(/^[^a-z]+/, "") || "unknown",
    occurredAt: new Date().toISOString(),
    payload,
  });
} catch {
  // Telemetry hooks never block Claude work.
}
