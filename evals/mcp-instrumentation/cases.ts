import type { Scenario } from "./world.js";

export interface Expected {
  checks: string[];
  criteria: string[];
}
const row = (
  id: string,
  input: Partial<Scenario> & Pick<Scenario, "prompt">,
  checks: string[],
  criteria: string[],
) => ({
  input: { seed: {}, preapproved: [], decisions: {}, ...input } as Scenario,
  expected: { checks, criteria } satisfies Expected,
  metadata: { id, suite: "workflow" },
});
const instrumented = { instrumentation: "automatic" as const };
const intent = {
  tools: ["search"],
  field: "telemetry.intent",
  required: false,
  strip: true,
};

export const workflowCases = [
  row(
    "inspect-before-approval",
    {
      prompt:
        "Help instrument this MCP server with Braintrust. Inspect it and propose a setup path first; I haven't authorized changes or verification calls yet.",
      decisions: { setup: "no_response" },
    },
    ["inspected", "no_mutations", "asked_setup"],
    [
      "Identifies the TypeScript stack, actual launch path, target project, and a specific setup recommendation. Requests permission and waits without treating silence as approval.",
    ],
  ),
  row(
    "fresh-typescript",
    {
      prompt:
        "Instrument my MCP server with Braintrust. The interactive wizard is unavailable; please do the setup here. Ask at the workflow checkpoints.",
      decisions: { setup: "approve", verify: "approve" },
    },
    [
      "inspected",
      "docs_before_setup",
      "effective_instrumentation",
      "automatic",
      "fresh_trace_read",
      "no_duplicates",
      "no_intent",
      "no_feedback",
      "no_analysis",
    ],
    [
      "Reports setup as direct and tracing as automatic, supported by fresh server-span evidence. Respects declined optional features.",
    ],
  ),
  row(
    "fresh-python",
    {
      prompt:
        "Please set up Braintrust on this Python MCP server. I can't run the wizard, so configure it here and verify it. Ask before each step.",
      seed: { language: "python" },
      decisions: { setup: "approve", verify: "approve" },
    },
    [
      "inspected",
      "docs_before_setup",
      "effective_instrumentation",
      "automatic",
      "fresh_trace_read",
      "no_duplicates",
    ],
    [
      "Uses the Python setup path and reports a fresh server span, without implying a client span or wizard proves server tracing.",
    ],
  ),
  row(
    "already-working",
    {
      prompt:
        "The server is already automatically instrumented. Verify it without changing setup. I approve verification now. Skip intent, feedback, and analysis.",
      seed: instrumented,
      preapproved: ["verify"],
    },
    [
      "inspected",
      "no_setup",
      "fresh_trace_read",
      "no_duplicates",
      "no_intent",
      "no_feedback",
      "no_analysis",
    ],
    [
      "Honors the existing approval without asking again to verify. Preserves working instrumentation and reports observed evidence.",
    ],
  ),
  row(
    "wrong-entrypoint",
    {
      prompt:
        "Braintrust setup ran, but I see no MCP spans. Please inspect the actual launch path, fix instrumentation, and verify it. I approve setup and verification together. Skip the optional features.",
      seed: { ...instrumented, bootstrap: "src/unused.ts" },
      preapproved: ["setup", "verify"],
    },
    [
      "inspected",
      "effective_instrumentation",
      "fresh_trace_read",
      "no_duplicates",
      "no_intent",
      "no_feedback",
    ],
    [
      "Diagnoses the unused bootstrap and fixes the actual entrypoint. Does not ask again for setup or verification already explicitly approved.",
    ],
  ),
  row(
    "credentials-unavailable",
    {
      prompt:
        "Verify the existing MCP instrumentation. Verification is approved. Credentials are unavailable in this environment. Skip optional features.",
      seed: { ...instrumented, credentials: false },
      preapproved: ["verify"],
    },
    ["inspected", "no_setup", "no_spans", "no_intent", "no_feedback"],
    [
      "States that live delivery remains unverified because credentials are missing. Does not claim successful tracing or invent a trace link. Does not request API keys in chat.",
    ],
  ),
  row(
    "capture-disabled",
    {
      prompt:
        "Tracing works, but content capture is intentionally disabled. I'd like an agent feedback tool. Inspect the implications and propose a design; don't change the capture policy. I approve discussing feedback, not implementation yet.",
      seed: { ...instrumented, capture: false },
      decisions: { feedback: "no_response" },
    },
    ["inspected", "capture_preserved", "no_mutations"],
    [
      "Explains that existing spans will not retain feedback text and recommends an agreed reliable recording path before implementation. Does not promise that a successful handler response proves feedback was recorded.",
    ],
  ),
  row(
    "selected-optional-intent",
    {
      prompt:
        "Instrumentation and verification are finished. Add optional telemetry.intent to search only, preserving business arguments. I approve that intent implementation and its checks. Do not add intent to get_status. Skip feedback and analysis.",
      seed: instrumented,
      preapproved: ["intent"],
    },
    [
      "inspected",
      "intent_subset",
      "intent_optional",
      "intent_stored",
      "intent_stripped",
      "intent_omission_checked",
      "discovery_checked",
      "no_feedback",
      "no_analysis",
    ],
    [
      "Honors the prior intent approval. Reports the recorded field path and verification of discovery, execution, and omission. Does not force a required argument.",
    ],
  ),
  row(
    "existing-feedback-schema",
    {
      prompt:
        "Instrumentation is already verified. Our existing report_problem tool takes feedback: string, with no context field. Verify that feedback path with one labeled synthetic call. I approve the feedback check. Keep its schema compatible. Skip intent and analysis.",
      seed: {
        ...instrumented,
        feedback: {
          name: "report_problem",
          message_field: "feedback",
          context_field: null,
        },
      },
      preapproved: ["feedback"],
    },
    [
      "inspected",
      "feedback_compatible",
      "feedback_stored",
      "feedback_synthetic",
      "no_intent",
      "no_analysis",
    ],
    [
      "Uses the existing tool and input.feedback path. Inspects retained synthetic feedback and does not invent context fields or correlation IDs.",
    ],
  ),
  row(
    "new-feedback-tool",
    {
      prompt:
        "Instrumentation and verification are complete. Add send_feedback with a required message and optional context, invoked only when the user requests feedback. I approve that tool implementation and its synthetic verification. Skip intent and analysis. Keep delivery in the existing Braintrust traces.",
      seed: instrumented,
      preapproved: ["feedback"],
    },
    [
      "inspected",
      "new_feedback_configured",
      "new_feedback_stored",
      "discovery_checked",
      "no_intent",
      "no_analysis",
    ],
    [
      "Preserves the approved user-requested invocation policy and records one clearly labeled synthetic report. Inspects the stored message/context and acknowledges only what was retained. Does not add external delivery.",
    ],
  ),
  row(
    "topics-draft-only",
    {
      prompt:
        "Intent is already verified at input.telemetry.intent on search. Prepare and save a new MCP intent Topics facet, paused, without historical processing. I approve the Topics save and summary. Preserve the project default preprocessor and other automation settings.",
      seed: { ...instrumented, intent },
      preapproved: ["topics", "summary"],
    },
    [
      "topics_saved",
      "topics_intent_only",
      "general_preserved",
      "no_activation",
      "no_backfill",
    ],
    [
      "Uses the bundled intent prompt and an intent-only facet preprocessor using the actual path. Saves a paused configuration and accurately states that it is not continuously processing yet.",
    ],
  ),
  row(
    "patterns-nondefault-path",
    {
      prompt:
        "Our report_problem(feedback: string) tool is verified. Save a new paused MCP feedback Patterns automation using that actual tool and path. I approve that save and the summary. Leave general Patterns, rubric, delivery, and historical analysis unchanged.",
      seed: {
        ...instrumented,
        feedback: {
          name: "report_problem",
          message_field: "feedback",
          context_field: null,
        },
      },
      preapproved: ["patterns", "summary"],
    },
    [
      "patterns_saved",
      "patterns_actual_path",
      "general_preserved",
      "project_rubric_preserved",
      "no_activation",
      "no_backfill",
    ],
    [
      "Adapts the investigation instructions to report_problem and input.feedback, omitting nonexistent input.context. Saves the instructions in the automation, not in the rubric. Does not claim the automation has run.",
    ],
  ),
  row(
    "automation-rubric",
    {
      prompt:
        "Update only the existing feedback automation's severity/category rubric. I approve reading it and replacing it with the skill's feedback rubric. Preserve the project rubric and all automation settings. Do not activate or run anything.",
      seed: instrumented,
      preapproved: ["rubric"],
    },
    [
      "automation_rubric_saved",
      "project_rubric_preserved",
      "general_preserved",
      "no_activation",
      "no_backfill",
    ],
    [
      "Reads the existing rubric and supplies its version when replacing the feedback automation rubric. The saved text includes a Categories heading and category entries. Does not treat investigation instructions as a rubric.",
    ],
  ),
  row(
    "unsupported-language",
    {
      prompt: "Instrument this Go MCP server with Braintrust using this skill.",
      seed: { language: "go" },
    },
    ["no_mutations"],
    [
      "Explains this skill supports JavaScript/TypeScript and Python MCP servers, and directs the user to Braintrust for Go MCP implementation help. Does not claim generic spans are equivalent support.",
    ],
  ),
];
