import test from "node:test";
import assert from "node:assert/strict";
import { descendants, duration, evidenceGroups, journeyData, parse, referencedSpans, traceRows } from "../skills/product-journey-evals/assets/journey-view-data.ts";

function row(id, type, name, parents = [], extra = {}) {
  return { id: `row-${id}`, span_id: id, root_span_id: "trace", span_parents: parents,
    data: { span_attributes: { type, name }, ...extra } };
}
function fixture() {
  return [row("root", "eval", "eval"),
    row("task", "task", "task", ["root"], { metrics: { start: 10, end: 52 }, output: { case: { id: "onboarding" }, journey: {} } }),
    row("agent", "task", "Agent", ["task"]),
    row("fetch", "tool", "WebFetch", ["agent"]),
    row("format", "tool", "StructuredOutput", ["agent"]),
    row("scorer", "score", "assertion_scores", ["root"], { output: {
      setup_friction: { score: .75, metadata: { choice: "MINOR", rationale: "Retry in row-fetch" } },
      doc_quality: { score: null, metadata: { choice: "NOT_NEEDED", applicable: false } },
    } }),
    row("judge-call", "llm", "Judge", ["scorer"]),
    row("judge-tool", "tool", "Judge helper", ["judge-call"]),
  ];
}

test("counts only the agent subtree, excluding scorer tools and output formatting", () => {
  const data = journeyData(fixture());
  assert.deepEqual(data.tools.map(r => r.span_id), ["fetch"]);
  assert.equal(data.seconds, 42);
  assert.equal(data.record.case.id, "onboarding");
});

test("reads canonical scorer output and preserves null applicability and source span", () => {
  const data = journeyData(fixture());
  assert.equal(data.scores.setup_friction.score, .75);
  assert.equal(data.scores.setup_friction.metadata.choice, "MINOR");
  assert.equal(data.scores.setup_friction.source, "scorer");
  assert.equal(data.scores.doc_quality.score, null);
  assert.equal(data.scores.doc_quality.metadata.applicable, false);
});

test("lazy fields are merged without mixing cases in grouped traces", () => {
  const rows = fixture();
  const other = { ...row("other", "task", "task"), root_span_id: "another-trace" };
  const all = [...rows, other];
  const trace = { spanOrder: all.map(r => r.span_id), spans: Object.fromEntries(all.map(r => [r.span_id, r])) };
  const hydrated = traceRows(trace, "trace", { fetch: { output: { error: "Timed out" } } });
  assert.equal(hydrated.length, rows.length);
  assert.equal(hydrated.find(r => r.span_id === "fetch").data.output.error, "Timed out");
});

test("resolves both row IDs and span IDs in explanations", () => {
  assert.deepEqual(referencedSpans("Retry in row-fetch and agent", fixture()).map(r => r.span_id), ["agent", "fetch"]);
});

test("handles out-of-order ancestry and cycles without including unrelated spans", () => {
  assert.deepEqual(descendants(fixture().reverse(), "task").map(r => r.span_id).sort(), ["agent", "fetch", "format", "task"]);
});

test("absent scores remain absent rather than generating successful labels", () => {
  const data = journeyData(fixture().filter(r => r.span_id !== "scorer"));
  assert.equal(data.scores.errors, undefined);
  assert.equal(duration(undefined), null);
  assert.deepEqual(parse('{"test":1}'), { test: 1 });
});

test("groups repeated source pages while preserving original evidence references", () => {
  const groups = evidenceGroups([
    { url: "https://example.com/start-here.md", observation: "First observation" },
    { url: "https://example.com/pricing", observation: "Another page" },
    { url: "https://example.com/start-here.md", observation: "Second observation" },
  ]);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].title, "Start here");
  assert.deepEqual(groups[0].items.map(item => item.index), [0, 2]);
  assert.equal(groups[1].items[0].index, 1);
});

test("hydrates labels from Braintrust's scorer metadata map and resolves native tool IDs", () => {
  const rows = fixture();
  const scorer = rows.find(row => row.span_id === "scorer");
  scorer.data.output = { doc_quality: { score: null }, errors: { score: .6 } };
  scorer.data.metadata = {
    doc_quality: { choice: "NOT_NEEDED", applicable: false },
    errors: { choice: "RECOVERED", rationale: "Recovered toolu_observed" },
  };
  rows.find(row => row.span_id === "fetch").data.metadata = { tool_call_id: "toolu_observed" };
  const data = journeyData(rows);
  assert.equal(data.scores.doc_quality.metadata.choice, "NOT_NEEDED");
  assert.equal(data.scores.errors.metadata.choice, "RECOVERED");
  assert.deepEqual(referencedSpans(data.scores.errors.metadata.rationale, rows).map(row => row.span_id), ["fetch"]);
});
