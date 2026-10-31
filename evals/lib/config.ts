import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import OpenAI from "openai";
import { wrapOpenAI } from "braintrust";

const envFile = fileURLToPath(new URL("../../.env", import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);

export const skillRoot = new URL(
  "../../skills/mcp-instrumentation/",
  import.meta.url,
);
export const readSkill = (path: string) =>
  readFileSync(new URL(path, skillRoot), "utf8");
const skillFiles = [
  "SKILL.md",
  ...readdirSync(new URL("references/", skillRoot))
    .sort()
    .map((p) => `references/${p}`),
];
export const skillHash = createHash("sha256")
  .update(skillFiles.map((p) => `${p}\n${readSkill(p)}`).join("\n"))
  .digest("hex");
const evalRoot = new URL("../", import.meta.url);
const evalFiles = readdirSync(evalRoot, { recursive: true })
  .map(String)
  .filter((p) => p.endsWith(".ts"))
  .sort();
const harnessHash = createHash("sha256")
  .update(
    evalFiles
      .map((p) => `${p}\n${readFileSync(new URL(p, evalRoot), "utf8")}`)
      .join("\n"),
  )
  .digest("hex");

function positiveInt(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < 1)
    throw new Error(`${name} must be a positive integer`);
  return value;
}

export const config = {
  project: process.env.BRAINTRUST_PROJECT ?? "braintrust-skills",
  model: process.env.EVAL_MODEL ?? "gpt-5-mini",
  judgeModel:
    process.env.EVAL_JUDGE_MODEL ?? process.env.EVAL_MODEL ?? "gpt-5-mini",
  trials: positiveInt("EVAL_TRIALS", 1),
  concurrency: positiveInt("EVAL_CONCURRENCY", 2),
  maxTurns: positiveInt("EVAL_MAX_TURNS", 24),
  withSkill: process.env.EVAL_WITH_SKILL !== "false",
  baseExperimentName: process.env.EVAL_BASE_EXPERIMENT,
};

export const experimentMetadata = {
  skill: "mcp-instrumentation",
  skill_sha256: skillHash,
  with_skill: config.withSkill,
  model: config.model,
  judge_model: config.judgeModel,
  environment: "simulated",
  harness_version: 1,
  harness_sha256: harnessHash,
  reasoning_effort: /gpt-5|^o[134]/.test(config.model)
    ? "low"
    : "provider-default",
};

export const reasoningOptions = (model: string) =>
  /gpt-5|^o[134]/.test(model) ? { reasoning_effort: "low" as const } : {};

export function selectCases<T extends { metadata: { id: string } }>(
  cases: T[],
): T[] {
  if (!process.env.EVAL_CASES) return cases;
  const wanted = new Set(
    process.env.EVAL_CASES.split(",").map((id) => id.trim()),
  );
  return cases.filter((row) => wanted.has(row.metadata.id));
}

let client: ReturnType<typeof wrapOpenAI<OpenAI>> | undefined;
export function modelClient() {
  if (!client) {
    const direct = Boolean(process.env.OPENAI_API_KEY);
    const apiKey = direct
      ? process.env.OPENAI_API_KEY
      : process.env.BRAINTRUST_API_KEY;
    if (!apiKey)
      throw new Error(
        "Run with bt eval (using its saved login), or set BRAINTRUST_API_KEY / OPENAI_API_KEY. See evals/README.md.",
      );
    client = wrapOpenAI(
      new OpenAI({
        apiKey,
        baseURL:
          process.env.EVAL_BASE_URL ??
          (direct ? undefined : "https://gateway.braintrust.dev"),
        timeout: 90_000,
        maxRetries: 1,
        // Independent trials must reach the provider, rather than replay cached answers.
        defaultHeaders: direct
          ? undefined
          : {
              "x-bt-use-cache": "never",
              ...(process.env.BRAINTRUST_ORG_NAME
                ? { "x-bt-org-name": process.env.BRAINTRUST_ORG_NAME }
                : {}),
            },
      }),
    );
  }
  return client;
}

export const skillPath = fileURLToPath(skillRoot);
