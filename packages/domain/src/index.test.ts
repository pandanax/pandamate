import assert from "node:assert/strict";
import test from "node:test";

import {
  buildProjectOnboarding,
  parseProjectOnboardingText,
  profileForProjectKind,
  validateCreateProjectInput,
  validateAdoptTmuxSessionInput,
  validateIdempotencyKey,
  validateMergeMode,
  validateProjectSlug,
  validateTmuxTarget,
} from "./index.ts";

test("validates and normalizes project input", () => {
  assert.deepEqual(
    validateCreateProjectInput({
      slug: "mandala-web",
      title: " Mandala ",
      kind: "git",
      mergeMode: "manual",
      workspace: "/workspace/mandala",
    }),
    {
      slug: "mandala-web",
      title: "Mandala",
      kind: "git",
      mergeMode: "manual",
      workspace: "/workspace/mandala",
    },
  );
});

test("validates project-owned merge modes", () => {
  assert.equal(validateMergeMode("auto"), "auto");
  assert.equal(validateMergeMode("manual"), "manual");
  assert.throws(() => validateMergeMode("firstmate"));
  assert.equal(
    validateCreateProjectInput({
      slug: "automerge",
      title: "Automerge",
      kind: "git",
      mergeMode: "auto",
      workspace: "/workspace/automerge",
    }).mergeMode,
    "auto",
  );
  assert.throws(() =>
    validateCreateProjectInput({
      slug: "arc-project",
      title: "Arc project",
      kind: "arc",
      mergeMode: "auto",
      workspace: "/workspace/arc-project",
    }),
  );
});

test("rejects unsafe project identity and non-canonical workspaces", () => {
  assert.throws(() => validateProjectSlug("Pandamate Home"));
  assert.throws(() => validateProjectSlug("write"), /reserved/);
  assert.throws(() => validateProjectSlug("service-scheduler"), /reserved/);
  assert.throws(() =>
    validateCreateProjectInput({
      slug: "safe",
      title: "Safe",
      kind: "git",
      workspace: "/workspace/../other",
    }),
  );
});

test("requires bounded idempotency keys", () => {
  assert.equal(validateIdempotencyKey("cli:project:123"), "cli:project:123");
  assert.throws(() => validateIdempotencyKey("short"));
  assert.throws(() => validateIdempotencyKey("contains spaces"));
});

test("validates adoptable tmux session identity", () => {
  assert.deepEqual(
    validateAdoptTmuxSessionInput({
      slug: "mandala",
      sessionName: "firstmate:mandala",
    }),
    { slug: "mandala", sessionName: "firstmate:mandala" },
  );
  assert.equal(validateTmuxTarget("$12"), "$12");
  assert.throws(() =>
    validateAdoptTmuxSessionInput({
      slug: "mandala",
      sessionName: "pandamate:home",
    }),
  );
  assert.throws(() => validateTmuxTarget("firstmate"));
});

test("builds project onboarding for all public profile names", () => {
  assert.deepEqual(
    buildProjectOnboarding(
      "FirstMateGit",
      "/workspace/My Site",
    ),
    {
      profile: "FirstMateGit",
      project: {
        slug: "my-site",
        title: "My Site",
        kind: "git",
        mergeMode: "manual",
        workspace: "/workspace/My Site",
      },
    },
  );
  assert.equal(
    buildProjectOnboarding("DocResearch", "/workspace/legal").project.kind,
    "docs",
  );
  assert.equal(profileForProjectKind("git"), "FirstMateGit");
});

test("parses dragged folders before or after a profile", () => {
  assert.equal(
    parseProjectOnboardingText(
      'Создай проект FirstMateArc "/workspace/arcadia project"',
    ).project.workspace,
    "/workspace/arcadia project",
  );
  assert.equal(
    parseProjectOnboardingText(
      "Подними /workspace/research как DocResearch",
    ).profile,
    "DocResearch",
  );
  assert.throws(() =>
    parseProjectOnboardingText("Создай проект из /workspace/unknown"),
  );
});
