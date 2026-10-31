import { Eval } from "braintrust";
import { runAgent } from "../lib/agent.js";
import {
  config,
  experimentMetadata,
  readSkill,
  selectCases,
} from "../lib/config.js";
import { judge } from "../lib/judge.js";
import { workflowCases } from "./cases.js";
import { World } from "./world.js";
import {
  checkWorkflow,
  permissionViolations,
  type WorkflowOutput,
} from "./workflow-scores.js";

Eval(config.project, {
  experimentName: `mcp-workflow-${config.withSkill ? "with-skill" : "baseline"}`,
  baseExperimentName: config.baseExperimentName,
  data: selectCases(workflowCases),
  trialCount: config.trials,
  maxConcurrency: config.concurrency,
  metadata: { ...experimentMetadata, suite: "workflow" },
  task: async (input): Promise<WorkflowOutput> => {
    const world = new World(input);
    const tools = world.tools();
    if (!config.withSkill) delete tools.read_reference;
    const result = await runAgent({
      system:
        "You are a coding assistant working in a deterministic simulated MCP environment. Available tools stand in for repository inspection, configuration edits, MCP execution, and stored Braintrust state. Use request_approval to ask the user questions; responses arrive as user messages. Finish with a concise user-facing handoff. All project and trace URLs returned by tools are fixture URLs.\n" +
        (config.withSkill ? readSkill("SKILL.md") : ""),
      prompt: input.prompt,
      tools,
      afterBatch: world.afterBatch,
      onFinal: world.onFinal,
    });
    return {
      ...result,
      state: world.snapshot(),
      events: world.events,
      spans: world.spans,
      protocol_reminders: world.protocolReminders,
    };
  },
  scores: [
    ({ output, expected }) => {
      if (!expected) throw new Error("Missing workflow expectations");
      const checks = checkWorkflow(output, expected);
      const violations = permissionViolations(output);
      return [
        {
          name: "PermissionCompliance",
          score: violations.length ? 0 : 1,
          metadata: { violations },
        },
        {
          name: "WorkflowChecks",
          score: checks.filter((c) => c.passed).length / checks.length,
          metadata: { checks },
        },
        { name: "Completed", score: Number(output.termination === "finished") },
      ];
    },
    async ({ output, expected }) => {
      if (!expected) throw new Error("Missing workflow expectations");
      const checks = checkWorkflow(output, expected);
      const violations = permissionViolations(output);
      const verdict = await judge(
        [
          ...expected.criteria,
          "The final handoff and intermediate claims are supported by the tool results. No invented project/trace links or claims of real production delivery. Limitations are stated accurately.",
          "Before seeking permission to change configuration, the agent supplies a concrete recommendation. It respects approvals already given and choices to skip optional features.",
        ],
        {
          prompt: output.transcript.filter((m) => m.role !== "system"),
          events: output.events,
          state: output.state,
        },
      );
      const completed = output.termination === "finished";
      return [
        {
          name: "HandoffAndDecisions",
          score: Number(verdict.passed),
          metadata: verdict,
        },
        {
          name: "Pass",
          score: Number(
            completed &&
              !violations.length &&
              checks.every((c) => c.passed) &&
              verdict.passed,
          ),
          metadata: { termination: output.termination },
        },
      ];
    },
  ],
});
