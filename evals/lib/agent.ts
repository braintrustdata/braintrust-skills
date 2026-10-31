import { traced } from "braintrust";
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions";
import { config, modelClient, reasoningOptions } from "./config.js";

export interface Tool {
  description: string;
  parameters: Record<string, unknown>;
  execute: (args: Record<string, unknown>) => unknown | Promise<unknown>;
}
export interface AgentResult {
  transcript: ChatCompletionMessageParam[];
  final: string;
  termination: "finished" | "turn_limit";
  turns: number;
  duration_ms: number;
}

export async function runAgent(options: {
  system: string;
  prompt: string;
  tools: Record<string, Tool>;
  afterBatch?: () => string[];
  onFinal?: (text: string) => string | undefined;
}): Promise<AgentResult> {
  const started = performance.now();
  const transcript: ChatCompletionMessageParam[] = [
    { role: "system", content: options.system },
    { role: "user", content: options.prompt },
  ];
  const tools: ChatCompletionTool[] = Object.entries(options.tools).map(
    ([name, tool]) => ({
      type: "function",
      function: {
        name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }),
  );
  for (let turn = 1; turn <= config.maxTurns; turn++) {
    const response = await modelClient().chat.completions.create({
      model: config.model,
      messages: transcript,
      tools,
      parallel_tool_calls: false,
      max_completion_tokens: 4096,
      ...reasoningOptions(config.model),
    });
    const message = response.choices[0]?.message;
    if (!message || response.choices[0]?.finish_reason === "length")
      throw new Error(
        "Agent response missing or truncated; increase token budget before grading",
      );
    transcript.push(message);
    if (!message.tool_calls?.length) {
      const reminder = options.onFinal?.(message.content ?? "");
      if (reminder) {
        transcript.push({ role: "user", content: reminder });
        continue;
      }
      return {
        transcript,
        final: message.content ?? "",
        termination: "finished",
        turns: turn,
        duration_ms: performance.now() - started,
      };
    }
    for (const call of message.tool_calls) {
      if (call.type !== "function")
        throw new Error("Unsupported model tool call");
      const tool = options.tools[call.function.name];
      let result: unknown;
      if (!tool) result = { error: `Unknown tool: ${call.function.name}` };
      else {
        let args: Record<string, unknown>;
        try {
          args = JSON.parse(call.function.arguments);
        } catch {
          throw new Error(`Invalid tool arguments: ${call.function.name}`);
        }
        result = await traced(
          async (span) => {
            span.log({ input: args });
            const value = await tool.execute(args);
            span.log({ output: value });
            return value;
          },
          { name: call.function.name, type: "tool" },
        );
      }
      transcript.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(result),
      });
    }
    // A requested approval cannot authorize sibling calls made before the user answers.
    for (const reply of options.afterBatch?.() ?? [])
      transcript.push({ role: "user", content: reply });
  }
  return {
    transcript,
    final: "",
    termination: "turn_limit",
    turns: config.maxTurns,
    duration_ms: performance.now() - started,
  };
}

export async function complete(
  system: string,
  input: unknown,
): Promise<string> {
  const response = await modelClient().chat.completions.create({
    model: config.model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: JSON.stringify(input) },
    ],
    max_completion_tokens: 2048,
    ...reasoningOptions(config.model),
  });
  const message = response.choices[0];
  if (!message?.message.content || message.finish_reason !== "stop")
    throw new Error("Incomplete model response");
  return message.message.content.trim();
}
