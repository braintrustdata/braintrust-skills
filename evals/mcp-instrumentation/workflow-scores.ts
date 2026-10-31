import type { AgentResult } from "../lib/agent.js";
import type { Expected } from "./cases.js";
import type { Event, Span, World } from "./world.js";

export interface WorkflowOutput extends AgentResult {
  state: ReturnType<World["snapshot"]>;
  events: Event[];
  spans: Span[];
  protocol_reminders: number;
}

export function hasIntentPreprocessor(config: unknown): boolean {
  if (!config || typeof config !== "object") return false;
  return Object.entries(config).some(([key, value]) => {
    if (/preprocessor/i.test(key)) {
      const text = JSON.stringify(value)
        ?.replaceAll("?", "")
        .replace(/\[['"]([^'"]+)['"]\]/g, ".$1");
      if (text?.includes("telemetry.intent")) return true;
    }
    return hasIntentPreprocessor(value);
  });
}

export function permissionViolations(
  output: Pick<WorkflowOutput, "events">,
): Event[] {
  return output.events.filter((event) =>
    event.required.some((scope) => !event.approved.includes(scope)),
  );
}

export function checkWorkflow(output: WorkflowOutput, expected: Expected) {
  const { state, events, spans } = output;
  const called = (tool: string) => events.some((e) => e.tool === tool);
  const freshRead = events.some(
    (e) =>
      e.tool === "query_logs" &&
      (e.result as { spans: Span[] }).spans.length > 0,
  );
  const topics = events.find(
    (e) => e.tool === "save_analysis" && e.args.kind === "topics",
  );
  const patterns = events.find(
    (e) => e.tool === "save_analysis" && e.args.kind === "patterns",
  );
  const checks: Record<string, boolean> = {
    inspected: called("inspect_server"),
    asked_setup: events.some(
      (e) => e.tool === "request_approval" && e.args.scope === "setup",
    ),
    no_mutations: events.every((e) => e.required.length === 0),
    docs_before_setup:
      events.findIndex((e) => e.tool === "read_docs") >= 0 &&
      events.findIndex((e) => e.tool === "read_docs") <
        events.findIndex((e) => e.tool === "configure_sdk"),
    effective_instrumentation:
      state.instrumentation !== "none" && state.bootstrap === state.launch,
    automatic: state.instrumentation === "automatic",
    fresh_trace_read: freshRead,
    no_duplicates: new Set(spans.map((s) => s.id)).size === spans.length,
    no_setup: !called("configure_sdk"),
    no_intent: !called("configure_intent"),
    no_feedback: !called("configure_feedback"),
    no_analysis:
      !called("save_analysis") &&
      !called("save_rubric") &&
      !called("run_analysis"),
    no_spans: spans.length === 0,
    capture_preserved: state.capture === false,
    intent_subset:
      state.intent?.tools.length === 1 && state.intent.tools[0] === "search",
    intent_optional: state.intent?.required === false,
    intent_stored:
      spans.some(
        (s) =>
          typeof (s.input?.telemetry as Record<string, unknown> | undefined)
            ?.intent === "string",
      ) && freshRead,
    intent_stripped:
      state.business_calls.length > 0 &&
      state.business_calls.every((input) => !("telemetry" in input)),
    intent_omission_checked: events.some(
      (e) =>
        e.tool === "exercise_mcp" &&
        e.args.name === "search" &&
        !("telemetry" in (e.args.input as object)) &&
        (e.result as { output: { result?: string } }).output.result === "ok",
    ),
    discovery_checked: called("list_tools"),
    feedback_compatible:
      state.feedback?.name === "report_problem" &&
      state.feedback.message_field === "feedback" &&
      state.feedback.context_field === null,
    feedback_stored:
      spans.some(
        (s) =>
          s.name === "tools/call report_problem" &&
          typeof s.input?.feedback === "string",
      ) && freshRead,
    feedback_synthetic:
      spans.filter((s) => s.name === "tools/call report_problem").length ===
        1 &&
      spans
        .filter((s) => s.name === "tools/call report_problem")
        .every(
          (s) =>
            s.synthetic &&
            /synthetic|test|eval/i.test(String(s.input?.feedback)),
        ),
    new_feedback_configured:
      state.feedback?.name === "send_feedback" &&
      state.feedback.message_field === "message" &&
      state.feedback.context_field === "context" &&
      events.some(
        (e) =>
          e.tool === "configure_feedback" &&
          e.args.invocation_policy === "user_requested",
      ),
    new_feedback_stored:
      spans.filter((s) => s.name === "tools/call send_feedback").length === 1 &&
      spans.some(
        (s) =>
          s.name === "tools/call send_feedback" &&
          s.synthetic &&
          /synthetic|test|eval/i.test(String(s.input?.message)) &&
          typeof s.input?.context === "object",
      ) &&
      freshRead,
    topics_saved: Boolean(topics),
    topics_intent_only: Boolean(
      topics &&
        hasIntentPreprocessor(topics.args.config) &&
        JSON.stringify(topics.args.config).includes("^NONE$") &&
        JSON.stringify(topics.args.config).includes("NONE"),
    ),
    patterns_saved: Boolean(patterns),
    patterns_actual_path: Boolean(
      patterns &&
        JSON.stringify(patterns.args.config).includes("report_problem") &&
        JSON.stringify(patterns.args.config).includes("input.feedback") &&
        !JSON.stringify(patterns.args.config).includes("input.context") &&
        !JSON.stringify(patterns.args.config).includes("send_feedback"),
    ),
    general_preserved:
      JSON.stringify(state.analysis.general) ===
      JSON.stringify({
        instructions: "Investigate general product issues",
        enabled: true,
      }),
    project_rubric_preserved:
      state.rubrics.project?.version === 3 &&
      state.rubrics.project.contents ===
        "## Categories\n- `billing`: Billing problems.",
    automation_rubric_saved:
      state.rubrics.feedback?.version === 3 &&
      /#+ Categories/.test(state.rubrics.feedback.contents) &&
      events.some((e) => e.tool === "inspect_analysis"),
    no_activation: events.every((e) => !e.required.includes("activation")),
    no_backfill:
      !called("run_analysis") &&
      events.every((e) => !e.required.includes("analysis")),
  };
  return expected.checks.map((name) => {
    if (!(name in checks)) throw new Error(`Unknown workflow check: ${name}`);
    return { name, passed: checks[name]! };
  });
}
