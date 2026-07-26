import assert from "node:assert/strict";
import test from "node:test";

import { buildBrainBriefing, PandamateBrain, routeProject } from "./index.ts";

test("builds a bounded briefing and routes only unambiguous projects", () => {
  const projects = [
    { slug: "mandala", title: "Mandala" },
    { slug: "legal", title: "Legal docs" },
  ];
  assert.deepEqual(routeProject("что с Mandala?", projects), {
    slug: "mandala",
    confidence: "exact",
  });
  assert.equal(routeProject("что происходит?", projects), null);
  const briefing = buildBrainBriefing(
    {
      projects: [],
      decisions: [],
      messages: [],
      events: [],
    },
    1_000,
  );
  assert.ok(briefing.length <= 1_000);
});

test("streams a brain result and retains the resumable session id", async () => {
  let closed = false;
  const brain = new PandamateBrain({
    cwd: "/tmp",
    claudeExecutable: "/tmp/claude",
    queryFactory: () => ({
      close: () => {
        closed = true;
      },
      async *[Symbol.asyncIterator]() {
        yield {
          type: "result",
          subtype: "success",
          result: "Everything is calm.",
          session_id: "00000000-0000-4000-8000-000000000001",
          duration_ms: 1,
          duration_api_ms: 1,
          is_error: false,
          num_turns: 1,
          stop_reason: "end_turn",
          total_cost_usd: 0,
          usage: {} as never,
          modelUsage: {},
          permission_denials: [],
          uuid: "00000000-0000-4000-8000-000000000002",
        };
      },
    }),
  });
  const chunks = [];
  for await (const chunk of brain.ask("Who needs me?", "{}")) {
    chunks.push(chunk);
  }
  assert.equal(chunks[0]?.text, "Everything is calm.");
  assert.equal(
    brain.sessionId,
    "00000000-0000-4000-8000-000000000001",
  );
  brain.cancel();
  assert.equal(closed, false);
});
