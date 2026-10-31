# Skill evaluations

These evaluations follow Braintrust's [evaluation quickstart](https://docs.braintrust.dev/evaluation-quickstart): versioned cases, an agent task, and independent scorers. The initial target is `mcp-instrumentation`.

## Setup

Use Node.js 22.20+ and the [`bt` CLI](https://docs.braintrust.dev/reference/cli). Install dependencies, authenticate, and configure your organization:

```bash
npm ci
bt login
cp .env.example .env
# Edit BRAINTRUST_ORG_NAME in .env to match your organization.
bt status
npm run eval:smoke
```

The default project is **braintrust-skills**. `bt eval` supplies credentials from your saved login; do not put tokens in source files. The local `.env` loads without overriding exported variables. The organization is passed explicitly to the Gateway to keep multi-organization accounts routed correctly.

By default, model calls use the [Braintrust Gateway](https://docs.braintrust.dev/deploy/gateway) and your organization's provider configuration. If your organization does not expose `gpt-5-mini`, set `EVAL_MODEL` and `EVAL_JUDGE_MODEL` to available tool-capable models. Alternatively, set `OPENAI_API_KEY` for direct OpenAI calls; Braintrust logging still uses your Braintrust login. `EVAL_BASE_URL` overrides the model endpoint.

## Run

```bash
# Full suite, one trial per case by default
npm run eval

# Individual suites
npm run eval:workflow
npm run eval:intent
npm run eval:feedback

# Validate the semantic judge against six known passing/failing examples
npm run eval:calibration

# Repeat trials to measure consistency
EVAL_TRIALS=3 npm run eval

# Focus on specific cases within one suite
EVAL_CASES=fresh-typescript,already-working npm run eval:workflow

# Baseline: same fixtures and cases, without skill text or bundled references
EVAL_WITH_SKILL=false npm run eval

# Compare one suite against a particular compatible baseline experiment
EVAL_BASE_EXPERIMENT=mcp-workflow-baseline npm run eval:workflow

# Execute model calls without uploading experiment logs
npm run eval:workflow -- --no-send-logs

# List evaluators without calling models
bt eval evals/mcp-instrumentation --list

# Check the harness offline; no model calls or Braintrust credentials required
npm run typecheck
npm test
```

The SDK prints the actual experiment URL. Repeated runs create distinct experiments. Metadata records the model, judge, skill and harness content hashes, baseline setting, harness version, reasoning effort, and simulated environment. `EVAL_CONCURRENCY` defaults to 2; `EVAL_MAX_TURNS` limits agent iterations to 24. GPT-5 and o-series models use low reasoning effort; other models use provider defaults. Gateway response caching is disabled so repeated trials can vary independently.

`--no-send-logs` controls Braintrust uploads; it still makes paid model calls and requires model credentials. When using a saved CLI login, keep the CLI authenticated even for local runs. The offline harness tests above require neither service.

## Coverage and interpretation

| Suite    | Cases | Measures                                                                                                                                                                                                                                                                                                                   |
| -------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Workflow | 14    | Initial approval and silence; direct TypeScript/Python setup; preserving existing instrumentation; unused launch paths; missing credentials; content capture policy; optional intent on selected tools; existing and new feedback tools; Topics/Patterns saves; automation-specific rubric updates; unsupported languages. |
| Intent   | 8     | Missing/vague intent; p95 versus average latency; useful task distinctions; identifier removal; avoiding invented goals; instruction-like input.                                                                                                                                                                           |
| Feedback | 9     | Synthetic reports; duplicated query rows; existing closed findings; corrected complaints; separate themes; nondefault feedback paths; structured context; exact window/scope; instruction-like reports.                                                                                                                    |

Workflow tests run a real model in a tool loop against a deterministic **simulated environment**. Tools stand in for repository inspection, edits, MCP calls, exported spans, and Braintrust configuration. Every trial starts with fresh state. The actor receives the scenario prompt and tool observations; expected assertions and scripted decision policy are withheld. Only `SKILL.md` is initially loaded, with references available on demand.

Approval replies arrive as separate user messages after the assistant's tool batch completes. Permission scoring inspects approvals at the time each operation occurred. An approval request cannot authorize a sibling mutation submitted before the user responds. Mutations remain observable in the fixture even when unauthorized, so the environment cannot manufacture a passing permission score by blocking them.

At the first terminal response, the driver sends one protocol check: deliver any outstanding approval question through `request_approval`, or finish if the task is complete or blocked. This avoids treating a valid prose permission question as the end of the entire conversation. The check grants no approval, provides no technical guidance, and does not infer consent from the assistant's wording. If the scripted user has intentionally given no response, the driver lets the assistant stop and wait without a reminder. The output records the reminder count.

These tests measure workflow decisions and analysis prompt behavior. They do **not** measure skill discovery, coding-agent filesystem edits, SDK compatibility, a real MCP transport, live telemetry delivery, or Topics clustering quality. In particular, the Python case tests workflow choices, not execution of generated Python code. Add isolated runnable server fixtures and live delivery smoke tests before treating results as instrumentation implementation coverage. The hosted `braintrust/pattern-analysis` skill is represented by a frozen, minimal fixture contract; the feedback suite evaluates the bundled investigation instructions, not the full hosted analysis agent.

Deterministic scorers check fixture state, action permissions, recorded fields, evidence IDs, distinct report counts, configuration scope, and preservation of unrelated resources. No-match intent cases require exactly `NONE` without a model judge. A separate model judge evaluates semantic task fidelity, decisions, and evidence-backed claims. Judge responses use strict structured output and are schema validated. Run `npm run eval:calibration`, read several initial transcripts, and calibrate the judge against human review before using it as a release gate.

The **Pass** score requires all relevant deterministic checks, the judge, and completion within the turn limit. Unauthorized actions cannot be averaged away by other passing checks. Look at component scores to diagnose failures, but compare strict Pass across trials to assess reliability. Deterministic scorers run independently so their results survive a judge failure. Provider, parsing, and judge failures remain evaluator errors rather than being silently converted into quality scores; inspect errors and missing scores before interpreting aggregate percentages. CLI exit success means the evaluator ran; it does not imply every case scored Pass=1.

Keep the model and judge fixed when comparing a skill revision. Use `EVAL_BASE_EXPERIMENT` with an individual suite to choose a compatible baseline; the SDK's automatic comparison can select a different suite's latest experiment when several suites share a project. Review failures before changing the skill, reserve new cases as a holdout, and report results by suite and scenario rather than relying only on a global average. The original skill and its permission checkpoints are not modified by this suite.

## Files

- `mcp-instrumentation/cases.ts`: workflow inputs and hidden expectations.
- `mcp-instrumentation/world.ts`: simulated application and approval driver.
- `mcp-instrumentation/workflow-scores.ts`: deterministic workflow checks.
- `mcp-instrumentation/feedback.ts`: feedback fixtures, tools, and finding checks.
- `mcp-instrumentation/*.eval.ts`: Braintrust data/task/scorer entry points.
- `mcp-instrumentation/harness.test.ts`: offline tests of permission timing, isolation, telemetry evidence, and grading failures.
- `lib/`: shared model client, bounded agent loop, skill hashing, and semantic judge.

The Braintrust SDK's `minimatch` dependency is overridden to `11.0.2` to include its resource-exhaustion fix. The eval runtime requires Node.js 22.20+ and does not use the SDK's legacy CLI glob discovery; `bt eval` performs discovery. Check compatibility and `npm audit` when updating the SDK or override.
