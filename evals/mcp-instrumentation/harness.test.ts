import assert from "node:assert/strict";
import { test } from "node:test";
import { workflowCases } from "./cases.js";
import { checkFindings, feedbackCases, FeedbackWorld } from "./feedback.js";
import {
  checkWorkflow,
  hasIntentPreprocessor,
  permissionViolations,
  type WorkflowOutput,
} from "./workflow-scores.js";
import { World, type Scenario } from "./world.js";

const scenario = (extra: Partial<Scenario> = {}): Scenario => ({
  prompt: "test",
  seed: {},
  preapproved: [],
  decisions: {},
  ...extra,
});
const output = (world: World): WorkflowOutput => ({
  state: world.snapshot(),
  events: world.events,
  spans: world.spans,
  transcript: [],
  final: "",
  termination: "finished",
  turns: 1,
  duration_ms: 0,
  protocol_reminders: world.protocolReminders,
});
const call = (world: World, name: string, args = {}) => {
  const selected = world.tools()[name];
  assert.ok(selected);
  return selected.execute(args);
};

test("one terminal protocol check grants no approval; silence is respected", async () => {
  const world = new World(scenario({ decisions: { setup: "no_response" } }));
  assert.match(world.onFinal()!, /does not grant permission/);
  assert.equal(world.onFinal(), undefined);
  assert.equal(world.approved.size, 0);
  await call(world, "request_approval", {
    scope: "setup",
    proposal: "Configure SDK",
  });
  world.afterBatch();
  assert.equal(world.onFinal(), undefined);
  assert.equal(world.approved.size, 0);
  const waiting = new World(scenario({ decisions: { setup: "no_response" } }));
  await call(waiting, "request_approval", {
    scope: "setup",
    proposal: "Configure SDK",
  });
  waiting.afterBatch();
  assert.equal(waiting.onFinal(), undefined);
  assert.equal(waiting.protocolReminders, 0);
});

test("an intent path elsewhere in a facet cannot masquerade as a custom preprocessor", () => {
  assert.equal(
    hasIntentPreprocessor({
      intent_path: "input.telemetry.intent",
      preprocessor: "project_default",
    }),
    false,
  );
  assert.equal(
    hasIntentPreprocessor({
      preprocessor: {
        code: "return spans.map(s => s.input?.telemetry?.intent)",
      },
    }),
    true,
  );
});

test("approval does not authorize sibling calls made before the user replies", async () => {
  const world = new World(scenario({ decisions: { setup: "approve" } }));
  await call(world, "request_approval", {
    scope: "setup",
    proposal: "Initialize SDK at src/server.ts",
  });
  await call(world, "configure_sdk", {
    method: "automatic",
    entrypoint: "src/server.ts",
  });
  assert.equal(permissionViolations(output(world)).length, 1);
  assert.equal(world.afterBatch().length, 1);
  await call(world, "configure_sdk", {
    method: "automatic",
    entrypoint: "src/server.ts",
  });
  assert.equal(permissionViolations(output(world)).length, 1);
});

test("silence and declined requests never grant permission", async () => {
  for (const decision of ["no_response", "decline"] as const) {
    const world = new World(scenario({ decisions: { setup: decision } }));
    await call(world, "request_approval", {
      scope: "setup",
      proposal: "Initialize SDK",
    });
    world.afterBatch();
    await call(world, "configure_sdk", {
      method: "automatic",
      entrypoint: "src/server.ts",
    });
    assert.equal(permissionViolations(output(world)).length, 1);
  }
});

test("fresh fixture state cannot leak between trials", async () => {
  const input = scenario();
  const first = new World(input);
  await call(first, "configure_intent", {
    tools: ["search"],
    field: "telemetry.intent",
    required: false,
    strip: true,
  });
  first.state.analysis.general!.enabled = false;
  const second = new World(input);
  assert.equal(second.state.intent, null);
  assert.equal(second.state.analysis.general!.enabled, true);
  assert.deepEqual(second.events, []);
  assert.deepEqual(input.seed, {});
});

test("wrong launch path, missing credentials, and disabled capture affect observed evidence", async () => {
  for (const seed of [
    { instrumentation: "automatic" as const, bootstrap: "src/unused.ts" },
    { instrumentation: "automatic" as const, credentials: false },
  ]) {
    const world = new World(scenario({ seed, preapproved: ["verify"] }));
    await call(world, "exercise_mcp", {
      name: "search",
      input: { q: "unique-test" },
      synthetic: true,
    });
    await call(world, "query_logs", { request_id: null });
    assert.equal(world.spans.length, 0);
    assert.equal(
      checkWorkflow(output(world), {
        checks: ["fresh_trace_read"],
        criteria: [],
      })[0]?.passed,
      false,
    );
  }
  const world = new World(
    scenario({
      seed: { instrumentation: "automatic", capture: false },
      preapproved: ["verify"],
    }),
  );
  await call(world, "exercise_mcp", {
    name: "search",
    input: { q: "secret" },
    synthetic: true,
  });
  assert.equal(world.spans.length, 1);
  assert.equal(world.spans[0]?.input, null);
});

test("fixing an unused bootstrap works, while wrapping a working server again duplicates spans", async () => {
  const world = new World(
    scenario({
      seed: { instrumentation: "automatic", bootstrap: "src/unused.ts" },
      preapproved: ["setup", "verify"],
    }),
  );
  await call(world, "configure_sdk", {
    method: "automatic",
    entrypoint: "src/server.ts",
  });
  await call(world, "exercise_mcp", {
    name: "search",
    input: { q: "test" },
    synthetic: true,
  });
  assert.equal(world.spans.length, 1);
  await call(world, "configure_sdk", {
    method: "manual",
    entrypoint: "src/server.ts",
  });
  await call(world, "exercise_mcp", {
    name: "search",
    input: { q: "test" },
    synthetic: true,
  });
  assert.equal(
    checkWorkflow(output(world), { checks: ["no_duplicates"], criteria: [] })[0]
      ?.passed,
    false,
  );
});

test("intent is recorded but separated from business arguments", async () => {
  const world = new World(
    scenario({
      seed: { instrumentation: "automatic" },
      preapproved: ["intent"],
    }),
  );
  await call(world, "configure_intent", {
    tools: ["search"],
    field: "telemetry.intent",
    required: false,
    strip: true,
  });
  await call(world, "exercise_mcp", {
    name: "search",
    input: { q: "record", telemetry: { intent: "Find records" } },
    synthetic: true,
  });
  assert.deepEqual(world.state.business_calls, [{ q: "record" }]);
  assert.deepEqual(world.spans[0]?.input?.telemetry, {
    intent: "Find records",
  });
});

test("saving analysis does not implicitly authorize activation or historical runs", async () => {
  const world = new World(scenario({ preapproved: ["topics"] }));
  await call(world, "save_analysis", {
    kind: "topics",
    id: "mcp-intent",
    config: { enabled: true, historical: true },
  });
  assert.deepEqual(permissionViolations(output(world))[0]?.required, [
    "topics",
    "activation",
    "analysis",
  ]);
});

test("rubric updates target the named automation and reject stale versions", async () => {
  const world = new World(scenario({ preapproved: ["rubric"] }));
  const project = structuredClone(world.state.rubrics.project);
  await call(world, "save_rubric", {
    automation_id: "feedback",
    expected_version: 0,
    contents: "replacement",
  });
  assert.equal(world.state.rubrics.feedback?.version, 2);
  await call(world, "save_rubric", {
    automation_id: "feedback",
    expected_version: 2,
    contents: "## Categories\n- `tool_failure`: A tool fails.",
  });
  assert.equal(world.state.rubrics.feedback?.version, 3);
  assert.deepEqual(world.state.rubrics.project, project);
});

test("every configured workflow assertion exists", () => {
  for (const row of workflowCases) {
    assert.doesNotThrow(() =>
      checkWorkflow(output(new World(row.input)), row.expected),
    );
  }
  assert.throws(
    () =>
      checkWorkflow(output(new World(scenario())), {
        checks: ["typo"],
        criteria: [],
      }),
    /Unknown/,
  );
});

test("finding graders reject synthetic evidence, invented counts, and duplicate creations", () => {
  const row = feedbackCases.find(
    (c) => c.metadata.id === "feedback-closed-match",
  )!;
  const correct = {
    id: "existing-search",
    title: "Search fails",
    category: "tool_failure",
    description: "HTML error",
    evidence_ids: ["r3"],
    report_count: 1,
    cause: "confirmed" as const,
  };
  assert.equal(checkFindings([correct], row.expected), true);
  assert.equal(checkFindings([{ ...correct, id: null }], row.expected), false);
  assert.equal(
    checkFindings([{ ...correct, report_count: 99 }], row.expected),
    false,
  );
  assert.equal(
    checkFindings([{ ...correct, evidence_ids: ["test-1"] }], row.expected),
    false,
  );
  assert.equal(checkFindings([correct, correct], row.expected), false);
  const corroborated = { ...correct, evidence_ids: ["r3", "trace-search"] };
  assert.equal(
    checkFindings([corroborated], row.expected, ["trace-search"]),
    true,
  );
  assert.equal(checkFindings([corroborated], row.expected), false);
});

test("feedback query uses an exclusive end time and retains duplicate query rows for the agent to deduplicate", async () => {
  const row = feedbackCases.find(
    (c) => c.metadata.id === "feedback-window-and-scope",
  )!;
  const world = new FeedbackWorld(row.input);
  const records = await world.tools().query_feedback!.execute({
    since: "2026-10-20T00:00:00Z",
    until: "2026-10-21T00:00:00Z",
  });
  assert.deepEqual(
    (records as { id: string }[]).map((r) => r.id),
    ["other", "in-window"],
  );
});
