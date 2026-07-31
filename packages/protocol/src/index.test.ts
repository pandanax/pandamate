import assert from "node:assert/strict";
import test from "node:test";

import { parseFrame, parseRequest, parseResponseFrame } from "./index.ts";

test("parses a bounded project creation request", () => {
  assert.equal(
    parseRequest({
      protocol: 1,
      requestId: "req_12345678",
      type: "project.create",
      idempotencyKey: "test:create:123",
      payload: {
        slug: "mandala",
        title: "Mandala",
        kind: "git",
        workspace: "/workspace/mandala",
      },
    }).type,
    "project.create",
  );
});

test("rejects malformed and oversized frames", () => {
  assert.throws(() => parseFrame("{"));
  assert.throws(() => parseFrame(`"${"x".repeat(1024 * 1024)}"`));
});

test("bounds event cursors", () => {
  assert.throws(() =>
    parseRequest({
      protocol: 1,
      requestId: "req_12345678",
      type: "event.list",
      payload: { after: -1, limit: 10 },
    }),
  );
});

test("validates desired-state commands", () => {
  const request = parseRequest({
    protocol: 1,
    requestId: "req_12345678",
    type: "project.desired.set",
    idempotencyKey: "test:start:mandala",
    payload: { slug: "mandala", desiredState: "running" },
  });
  assert.equal(request.type, "project.desired.set");
  assert.throws(() =>
    parseRequest({
      protocol: 1,
      requestId: "req_12345678",
      type: "project.desired.set",
      idempotencyKey: "test:start:mandala",
      payload: { slug: "mandala", desiredState: "unknown" },
    }),
  );
});

test("validates project-owned merge mode commands", () => {
  assert.deepEqual(
    parseRequest({
      protocol: 1,
      requestId: "req-merge-mode",
      type: "project.merge_mode.set",
      idempotencyKey: "test:merge:mode",
      payload: { slug: "pandamate", mergeMode: "auto" },
    }),
    {
      protocol: 1,
      requestId: "req-merge-mode",
      type: "project.merge_mode.set",
      idempotencyKey: "test:merge:mode",
      payload: { slug: "pandamate", mergeMode: "auto" },
    },
  );
  assert.throws(() =>
    parseRequest({
      protocol: 1,
      requestId: "req-merge-mode",
      type: "project.merge_mode.set",
      idempotencyKey: "test:merge:mode",
      payload: { slug: "pandamate", mergeMode: "firstmate" },
    }),
  );
});

test("validates durable tmux adoption commands", () => {
  const request = parseRequest({
    protocol: 1,
    requestId: "req_12345678",
    type: "project.tmux.adopt",
    idempotencyKey: "test:adopt:mandala",
    payload: { slug: "mandala", sessionName: "firstmate" },
  });
  assert.equal(request.type, "project.tmux.adopt");
  assert.throws(() =>
    parseRequest({
      protocol: 1,
      requestId: "req_12345678",
      type: "project.tmux.adopt",
      idempotencyKey: "test:adopt:control",
      payload: { slug: "mandala", sessionName: "pandamate:home" },
    }),
  );
});

test("validates response envelopes", () => {
  assert.equal(
    parseResponseFrame(
      '{"protocol":1,"requestId":"req_12345678","ok":true,"data":{"pong":true,"pid":12}}',
    ).ok,
    true,
  );
  assert.throws(() =>
    parseResponseFrame(
      '{"protocol":2,"requestId":"req_12345678","ok":true,"data":{}}',
    ),
  );
});

test("validates bounded mailbox requests", () => {
  const created = parseRequest({
    protocol: 1,
    requestId: "req-message",
    type: "message.create",
    idempotencyKey: "test:message:create",
    payload: {
      projectSlug: "mandala",
      text: "Run the verification.",
      priority: "high",
    },
  });
  assert.equal(created.type, "message.create");
  const leased = parseRequest({
    protocol: 1,
    requestId: "req-lease",
    type: "message.lease",
    payload: {
      projectSlug: "mandala",
      leaseOwner: "firstmate:mandala",
      leaseMilliseconds: 60_000,
      limit: 10,
    },
  });
  assert.equal(leased.type, "message.lease");
  assert.throws(() =>
    parseRequest({
      protocol: 1,
      requestId: "req-bad-lease",
      type: "message.lease",
      payload: {
        projectSlug: "mandala",
        leaseOwner: "firstmate:mandala",
        leaseMilliseconds: 1,
        limit: 10,
      },
    }),
  );
});

test("parses a drain request and rejects one without a decision", () => {
  const drain = parseRequest({
    protocol: 1,
    requestId: "req-drain",
    type: "system.drain",
    payload: { draining: true },
  });
  assert.equal(drain.type, "system.drain");
  assert.deepEqual(drain.payload, { draining: true });
  assert.throws(() =>
    parseRequest({
      protocol: 1,
      requestId: "req-drain-bad",
      type: "system.drain",
      payload: { draining: "yes" },
    }),
  );
});
