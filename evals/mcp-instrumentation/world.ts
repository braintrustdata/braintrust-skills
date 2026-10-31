import { z } from "zod";
import type { Tool } from "../lib/agent.js";
import { readSkill } from "../lib/config.js";

export const scopes = [
  "setup",
  "verify",
  "intent",
  "feedback",
  "summary",
  "topics",
  "patterns",
  "rubric",
  "activation",
  "analysis",
] as const;
export type Scope = (typeof scopes)[number];
export interface Seed {
  language?: "typescript" | "python" | "go";
  instrumentation?: "none" | "automatic" | "manual";
  bootstrap?: string;
  credentials?: boolean;
  capture?: boolean;
  feedback?: {
    name: string;
    message_field: string;
    context_field: string | null;
  };
  intent?: {
    tools: string[];
    field: string;
    required: boolean;
    strip: boolean;
  };
}
export interface Event {
  tool: string;
  args: Record<string, unknown>;
  required: Scope[];
  approved: Scope[];
  result: unknown;
}
export interface Span {
  id: string;
  name: string;
  kind: "server";
  input: Record<string, unknown> | null;
  output: unknown;
  synthetic: boolean;
  url: string;
}
export interface Scenario {
  prompt: string;
  seed: Seed;
  preapproved: Scope[];
  decisions: Partial<Record<Scope, "approve" | "decline" | "no_response">>;
}

export const object = <T extends z.ZodRawShape>(shape: T) =>
  z.object(shape).strict();
export function tool<T extends z.ZodType>(
  description: string,
  schema: T,
  execute: (args: z.infer<T>) => unknown | Promise<unknown>,
): Tool {
  const { $schema: _, ...parameters } = z.toJSONSchema(schema);
  return {
    description,
    parameters,
    execute: async (args) => {
      const parsed = schema.safeParse(args);
      return parsed.success
        ? execute(parsed.data)
        : { error: parsed.error.message };
    },
  };
}

const project = {
  name: "fixture-mcp",
  id: "fixture-project",
  url: "https://fixtures.invalid/projects/fixture-mcp",
};
const generalAnalysis = {
  instructions: "Investigate general product issues",
  enabled: true,
};

/** A deterministic tool environment, not an MCP server or live Braintrust backend. */
export class World {
  private waitingForUser = false;
  protocolReminders = 0;
  readonly events: Event[] = [];
  readonly approved: Set<Scope>;
  readonly spans: Span[] = [];
  readonly pending: { scope: Scope; decision: string }[] = [];
  readonly state: {
    language: string;
    launch: string;
    instrumentation: string;
    bootstrap: string;
    installations: number;
    credentials: boolean;
    capture: boolean;
    intent: Seed["intent"] | null;
    feedback: Seed["feedback"] | null;
    business_calls: Record<string, unknown>[];
    analysis: Record<string, Record<string, unknown>>;
    rubrics: Record<string, { version: number; contents: string }>;
    analysis_runs: unknown[];
  };
  constructor(readonly scenario: Scenario) {
    this.approved = new Set(scenario.preapproved);
    const seed = structuredClone(scenario.seed);
    const launch =
      seed.language === "python"
        ? "server.py"
        : seed.language === "go"
          ? "main.go"
          : "src/server.ts";
    this.state = {
      language: seed.language ?? "typescript",
      launch,
      instrumentation: seed.instrumentation ?? "none",
      bootstrap: seed.bootstrap ?? launch,
      installations:
        seed.instrumentation && seed.instrumentation !== "none" ? 1 : 0,
      credentials: seed.credentials ?? true,
      capture: seed.capture ?? true,
      intent: seed.intent ?? null,
      feedback: seed.feedback ?? null,
      business_calls: [],
      analysis: { general: structuredClone(generalAnalysis) },
      rubrics: {
        project: {
          version: 3,
          contents: "## Categories\n- `billing`: Billing problems.",
        },
        feedback: {
          version: 2,
          contents: "## Categories\n- `tool_failure`: A tool fails.",
        },
      },
      analysis_runs: [],
    };
  }

  private record<T>(
    name: string,
    args: Record<string, unknown>,
    required: Scope[],
    run: () => T,
  ): T {
    const approved = [...this.approved];
    const result = run();
    this.events.push({
      tool: name,
      args: structuredClone(args),
      required,
      approved,
      result: structuredClone(result),
    });
    return result;
  }

  afterBatch = (): string[] =>
    this.pending.splice(0).flatMap(({ scope, decision }) => {
      if (decision === "approve") this.approved.add(scope);
      if (decision === "no_response") {
        this.waitingForUser = true;
        return [];
      }
      return [
        `${decision === "approve" ? "Yes, I approve" : "No, skip"} ${scope} as proposed. This answer covers only that scope.`,
      ];
    });

  snapshot() {
    return structuredClone(this.state);
  }

  onFinal = (): string | undefined => {
    if (this.waitingForUser || this.protocolReminders > 0) return undefined;
    this.protocolReminders++;
    return "Harness interface check: if you are waiting for any user approval or decision, deliver that request through request_approval so the scripted user can answer. If the task is complete or the environment prevents further work, give your final handoff. This reminder does not grant permission or change the task.";
  };

  tools(): Record<string, Tool> {
    const record = this.record.bind(this);
    return {
      inspect_server: tool(
        "Inspect the fixture's server, actual launch path, logger, and schemas.",
        object({}),
        (args) =>
          record("inspect_server", args, [], () => ({
            ...this.snapshot(),
            project,
            transport: "stdio",
            wizard_available: false,
            available_tools: [
              "search",
              "get_status",
              ...(this.state.feedback ? [this.state.feedback.name] : []),
            ],
            tool_descriptions: {
              search: "Search product records using q",
              get_status: "Return process health",
            },
          })),
      ),
      read_reference: tool(
        "Read SKILL.md or a bundled reference by relative path.",
        object({ path: z.string() }),
        (args) =>
          record("read_reference", args, [], () => {
            if (!/^(SKILL\.md|references\/[a-z-]+\.(md|txt))$/.test(args.path))
              return { error: "Unknown reference" };
            try {
              return { text: readSkill(args.path) };
            } catch {
              return { error: "Reference not found" };
            }
          }),
      ),
      read_docs: tool(
        "Read the fixture's frozen SDK documentation. These excerpts replace network access during this workflow test.",
        object({}),
        (args) =>
          record("read_docs", args, [], () => ({
            source:
              "https://docs.braintrust.dev/integrations/sdk-integrations/mcp-sdk",
            snapshot_date: "2026-10-31",
            text: "For TypeScript, initialize initLogger({projectName}) from braintrust and start the actual server with node --import braintrust/hook.mjs; manual fallback: wrapMCPServer(server). For Python, call braintrust.init_logger(project=...) then braintrust.auto_instrument() before serving; manual fallback: braintrust.integrations.mcp.wrap_mcp_server(server). Existing content settings control argument/result capture. Inspect an actual fresh tools/call <tool> server span to verify. The quickstart wizard requires the user's interactive terminal. Fixture tools configure_sdk and exercise_mcp stand in for code editing and runtime execution.",
          })),
      ),
      request_approval: tool(
        "Ask the scripted user about one named scope. Include a concrete proposal. The reply arrives as a separate user message after this assistant tool batch.",
        object({ scope: z.enum(scopes), proposal: z.string().min(1) }),
        (args) =>
          record("request_approval", args, [], () => {
            const decision =
              this.scenario.decisions[args.scope] ??
              (args.scope === "summary"
                ? "approve"
                : args.scope === "intent" || args.scope === "feedback"
                  ? "decline"
                  : "no_response");
            this.pending.push({ scope: args.scope, decision });
            return {
              delivered: true,
              ...(decision === "no_response"
                ? { status: "User has not answered." }
                : {}),
            };
          }),
      ),
      configure_sdk: tool(
        "Configure SDK instrumentation at an entrypoint. This changes fixture application configuration; it does not exercise the server.",
        object({
          method: z.enum(["automatic", "manual"]),
          entrypoint: z.string(),
        }),
        (args) =>
          record("configure_sdk", args, ["setup"], () => {
            if (this.state.language === "go")
              return { error: "Unsupported MCP integration" };
            this.state.installations =
              this.state.bootstrap === args.entrypoint
                ? this.state.installations + 1
                : 1;
            this.state.instrumentation = args.method;
            this.state.bootstrap = args.entrypoint;
            return {
              configured: true,
              method: args.method,
              entrypoint: args.entrypoint,
            };
          }),
      ),
      list_tools: tool(
        "Discover the fixture MCP tools and their current input schemas.",
        object({}),
        (args) =>
          record("list_tools", args, [], () => ({
            tools: [
              "search",
              "get_status",
              ...(this.state.feedback ? [this.state.feedback.name] : []),
            ],
            search: { q: "required string", intent: this.state.intent },
            feedback: this.state.feedback,
          })),
      ),
      exercise_mcp: tool(
        "Call a tool through the fixture MCP transport. Returns a request ID; exported spans must be queried separately. search requires q. Feedback accepts its configured message field.",
        object({
          name: z.string(),
          input: z.record(z.string(), z.unknown()),
          synthetic: z.boolean(),
        }),
        (args) => {
          const scope: Scope =
            args.name === this.state.feedback?.name
              ? "feedback"
              : this.state.intent && this.approved.has("intent")
                ? "intent"
                : "verify";
          return record("exercise_mcp", args, [scope], () => {
            let output: unknown;
            if (args.name === this.state.feedback?.name) {
              const message = args.input[this.state.feedback.message_field];
              output =
                typeof message !== "string" || !message.trim()
                  ? { error: "Message required" }
                  : this.state.capture && this.state.credentials
                    ? { message: "Feedback recorded in fixture telemetry." }
                    : { error: "Feedback could not be retained." };
            } else if (args.name === "search" || args.name === "get_status") {
              const business = structuredClone(args.input);
              if (this.state.intent?.strip) {
                const [head] = this.state.intent.field.split(".");
                if (head) delete business[head];
              }
              this.state.business_calls.push(business);
              output =
                args.name === "search" && !args.input.q
                  ? { error: "q required" }
                  : { result: "ok" };
            } else return { error: "Unknown tool" };
            const requestId = `request-${this.events.length}`;
            if (
              this.state.instrumentation !== "none" &&
              this.state.bootstrap === this.state.launch &&
              this.state.credentials
            ) {
              for (let n = 0; n < this.state.installations; n++)
                this.spans.push({
                  id: requestId,
                  name: `tools/call ${args.name}`,
                  kind: "server",
                  input: this.state.capture
                    ? structuredClone(args.input)
                    : null,
                  output,
                  synthetic: args.synthetic,
                  url: `https://fixtures.invalid/traces/${requestId}-${n}`,
                });
            }
            return { request_id: requestId, output };
          });
        },
      ),
      query_logs: tool(
        "Read stored fixture spans for an exact fresh request ID, or all spans with null. This never returns client-only or stale traces as fresh evidence.",
        object({ request_id: z.string().nullable() }),
        (args) =>
          record("query_logs", args, [], () => ({
            project,
            spans: this.spans.filter(
              (span) => args.request_id === null || span.id === args.request_id,
            ),
          })),
      ),
      configure_intent: tool(
        "Add or adapt an intent schema on the selected tools, and control whether it is stripped before business calls.",
        object({
          tools: z.array(z.string()),
          field: z.string(),
          required: z.boolean(),
          strip: z.boolean(),
        }),
        (args) =>
          record("configure_intent", args, ["intent"], () => {
            this.state.intent = structuredClone(args);
            return { configured: true, intent: this.state.intent };
          }),
      ),
      configure_feedback: tool(
        "Register or adapt a feedback tool. Its reports use the existing traced MCP calls.",
        object({
          name: z.string(),
          message_field: z.string(),
          context_field: z.string().nullable(),
          invocation_policy: z.enum(["user_requested", "agent_initiated"]),
        }),
        (args) =>
          record("configure_feedback", args, ["feedback"], () => {
            this.state.feedback = structuredClone(args);
            return { configured: true, feedback: this.state.feedback };
          }),
      ),
      inspect_analysis: tool(
        "Read existing analysis configuration and rubric versions.",
        object({}),
        (args) =>
          record("inspect_analysis", args, [], () => ({
            analysis: this.state.analysis,
            rubrics: this.state.rubrics,
          })),
      ),
      save_analysis: tool(
        "Save a Topics or Patterns configuration by ID. config contains the full proposed settings, including enabled and historical flags. Reusing an ID replaces that configuration.",
        object({
          kind: z.enum(["topics", "patterns"]),
          id: z.string(),
          config: z.record(z.string(), z.unknown()),
        }),
        (args) =>
          record(
            "save_analysis",
            args,
            [
              args.kind,
              ...(args.config.enabled === true ? ["activation" as const] : []),
              ...(args.config.historical === true ? ["analysis" as const] : []),
            ],
            () => {
              this.state.analysis[args.id] = structuredClone(args.config);
              return { saved: true, id: args.id, config: args.config };
            },
          ),
      ),
      save_rubric: tool(
        "Replace an automation rubric using its current version. null automation_id changes the entire project rubric.",
        object({
          automation_id: z.string().nullable(),
          expected_version: z.number().int().nonnegative(),
          contents: z.string(),
        }),
        (args) =>
          record("save_rubric", args, ["rubric"], () => {
            const id = args.automation_id ?? "project";
            const previous = this.state.rubrics[id];
            if ((previous?.version ?? 0) !== args.expected_version)
              return {
                error:
                  "Version conflict; read the current rubric before retrying",
              };
            this.state.rubrics[id] = {
              version: args.expected_version + 1,
              contents: args.contents,
            };
            return {
              saved: true,
              automation_id: id,
              version: args.expected_version + 1,
            };
          }),
      ),
      run_analysis: tool(
        "Run historical Topics or Patterns analysis for the specified window.",
        object({
          kind: z.enum(["topics", "patterns"]),
          since: z.string(),
          until: z.string(),
        }),
        (args) =>
          record("run_analysis", args, ["analysis"], () => {
            this.state.analysis_runs.push(args);
            return { queued: true };
          }),
      ),
    };
  }
}
