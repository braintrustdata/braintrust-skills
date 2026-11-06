---
name: product-journey-evals
description: "Evaluate product journeys with traced agents in Braintrust without access to the product's code. Use for onboarding, signup, plan selection, feature discovery, support, docs, or other user flows with scored experiments and evidence-linked friction reports."
---

# Product journey evals

Turn a public-facing task into a Braintrust eval: a case describes a user's goal,
the task launches an instrumented agent, and scorers assess the observed journey.
Instrument the **visiting agent**, not the product. No product SDK integration or
source access is needed.

Start with one useful journey. A single run can expose a concrete blocker; it
does not estimate a population success rate or represent human usability.

## Establish the journey and destination

Infer the target URL, goal, persona, and completion criteria from the request.
Choose a small, observable endpoint: complete onboarding, choose a plan, discover
a feature, configure a test account, resolve a support question, or find specific
instructions. Separate learning how to perform an action from actually doing it.
Specify the allowed domains, account state, time budget, and permitted actions.
Public pages can be read immediately; account changes and purchases need the
authorization appropriate to the user's request.

Check the available execution and tracing tools before constructing the eval:

```bash
bt status --json
bt projects list --json
bt trace run --help
bt eval --help
```

Use the configured org and project unless the user selected another destination.
Carry the same profile/org into both the eval and its subprocesses. Do not print
credentials, switch orgs silently, or enable persistent tracing for a one-off.
The agent's own login is separate from Braintrust authentication.

Check the selected agent CLI's help and available browser/fetch tools. Fetching
Markdown tests documentation discoverability and comprehension; it cannot verify
visual UI, interactive signup, or a browser session. For those journeys configure
a browser tool the child agent can actually access. A tool available to the parent
agent is not automatically available to the child. Report missing access as an
execution limitation, not a product defect. Use fresh agent and browser sessions
for independent trials; document any reused login state.

## Scaffold a runnable eval

Copy the contents of [assets/](assets/) into an isolated working directory. The
starter supports Claude Code and Codex, a JSON case file, bounded subprocesses,
structured journey evidence, and a Braintrust custom trace view. Adapt it to the actual
journey and tools. The included cases illustrate plan selection and reading docs;
replace them with the user's actual journey. Neither example submits forms.

Install the eval and judge dependencies into that directory's Python environment:

```bash
uv venv .venv
uv pip install --python .venv/bin/python braintrust jsonschema autoevals openai
```

Edit `cases.json`: each input contains a stable `id`, `url`, `goal`, `persona`,
`allowed_domains`, `allowed_actions`, and `criteria` with stable IDs and observable
descriptions. Encode the actions already authorized by the user's request.
These are user task specifications, not fabricated traces or expected outcomes.
Record the agent/model, tools, prompt revision, budget, and account state when
comparing runs. Keep the visitor prompt neutral: give the goal and constraints,
not the solution or private product knowledge. Provision the browser, test account,
and tool permissions needed for interactive journeys. The prompt follows each
case's `allowed_actions`; cases without that field default to public browsing.
The Codex adapter starts with a read-only filesystem sandbox; browser actions
still need their own permissions. Configure an appropriate sandbox explicitly
if the authorized journey requires local file writes.

The essential connection is inside the eval task:

```python
parent = hooks.span.export()
# Pass this opaque string unchanged as one argument. It is NOT a trace ID.
subprocess.run(["bt", "trace", "run", "--parent", parent,
                "claude", "--", "-p", prompt], check=True)
```

Expected hierarchy (the plugin's intermediate spans vary by agent):

```text
eval case
  task
    traced agent session
      model / tool / turn spans
  scorer spans
```

Do not substitute a new logger, a project ID, a URL, or an exported experiment
for the **active task span**. Do not wrap the whole eval CLI in a second trace
and assume the agent spans will attach. Wait for the child to finish before
returning the task output. Let the Braintrust SDK create the eval/task/score
spans and the coding-agent tracing integration capture the child activity.

Run one case first (in the scaffold directory):

```bash
FLOW_AGENT=claude bt eval --runner .venv/bin/python journey.eval.py --first 1
```

`FLOW_AGENT=codex` selects the other adapter. `FLOW_MODEL` selects a model;
`FLOW_TIMEOUT_SECONDS` bounds each child (default 180). `FLOW_AGENT_ARGS` is a
JSON array of additional agent arguments, for example an existing browser MCP
configuration or a Claude tool allowlist. Preserve the user's permission policy;
do not add permission-bypass flags. `FLOW_PROJECT` can select a project name;
otherwise the template uses the configured project's name and ID. Use `bt`'s
profile/org options for a different authorized destination.

## Verify capture, then analyze

An agent exiting successfully does not prove trace delivery. Open the task's
permalink (saved in the result JSON), confirm the agent spans share the case's
`root_span_id`, and inspect at least one tool input/output. Use `bt trace status`
and `bt trace doctor <agent>` if delivery is missing. For programmatic inspection,
resolve the experiment ID from the eval summary or `bt experiments list --json`,
then query `experiment('<experiment-id>')`, **not** `project_logs(...)`:

```sql
SELECT id, span_id, root_span_id, span_parents, span_attributes, error
FROM experiment('<experiment-id>')
WHERE created >= '<run-start-UTC>' AND created < '<run-end-UTC>'
LIMIT 100
```

Use concrete timestamps, paginate if needed, and inspect full payloads only for
the relevant spans. If trace visibility is delayed, do a bounded recheck; don't
rerun the paid journey to fix ingestion. Say exactly which parts were verified.

Review the agent's criterion-level evidence against the actual tool spans.
Distinguish product friction from agent mistakes, tool permissions, missing login,
network failures, and unknown causes. Record the observed action, exact URL,
evidence, impact, recovery, and suggested fix. Cite span IDs/permalinks where
available. Self-reported success and quotes are provisional until corroborated.

The starter automatically computes these visitor-report checks in Braintrust:

- `execution_ok`: the child returned a valid structured record, including a
  record explaining an environment limitation.
- `completion`: all criteria were met with cited evidence; unknown criteria or
  environment/agent/unknown blockers leave it unscored.
- `evidence_coverage`: share of criteria citing evidence.

These checks validate the visitor's **reported** outcome. The separate
`assertion_scores` scorer applies the
[general assertion structure](references/assertions.md), informed by docs-agent-eval,
to captured native agent events. The five evaluation dimensions are:

- **Setup friction** (`setup_friction`): prerequisites, signup/login, credentials,
  permissions, configuration, retries, and assistance needed to begin the task.
- **Speed** (`speed`): duration of each task, with every attempted case visible in
  the report. Compare like tasks and starting states.
- **Tool-call efficiency** (`efficiency`): actual invocation count, including
  retries. Fewer calls score higher against configurable task-specific thresholds.
- **Errors encountered** (`errors`): actual failures, their frequency, severity,
  cause, and recovery, including errors that were eventually resolved.
- **Docs availability and quality** (`doc_quality`): whether needed help was
  available, discoverable, correct, and useful. It is N/A when no docs were needed
  or consulted; a failed search for needed docs remains an applicable finding.

Timing, tool calls, and errors come from traced activity; do not create a second
collection system or ask the visitor to invent counters. The existing CLI capture
and elapsed-time fields support local scoring; trace spans remain the source of
truth when checking results. The report shows evidence and links into that trace.

`task_completed` is a supporting outcome check, and `used_web_tools` a diagnostic;
a fast attempt with few calls may still fail its task. Setup/docs judges explicitly
mark inapplicable dimensions, while missing evidence or a judge failure stays
unscored. There is no default composite that obscures these dimensions. Add
task-specific assertions in `expected.assertions`; configure `expected.dx_weights`
only if a composite is useful. These run as eval scorer spans automatically;
no project-wide scorer deployment is required.

The rubric and label mappings live in `assertions.json`. Judge explanations and
labels are logged on scorer spans and shown in the custom view. Set
`FLOW_JUDGE_MODEL` to choose a judge (default `gpt-5.4`, matching the pinned
upstream implementation). The judge uses an instrumented OpenAI client against
the Braintrust AI proxy with credentials provided by `bt eval`; the org must have
the selected model available. `FLOW_JUDGE_BASE_URL` and `FLOW_JUDGE_API_KEY` can
select an explicitly configured compatible endpoint. Keep
evaluator-only acceptance details in the case's `expected` field: the visitor
receives only `input`.

The CLI adapters capture structured tool calls and observations as a separate
`capture` record, rather than counting tool names in generated prose. Missing or
truncated activity, failed runs, and judge failures produce N/A assertions, never
automatic passes. The visitor report and LLM assertion can disagree: inspect the
supporting tool IDs in the judge's explanation. Review successful and failed
examples before trusting a judge; keep harness health separate from product
quality. Do not give the visitor its expected answer.

## Publish the Braintrust custom view

Use the bundled `product-journey.trace-view.tsx` and `journey-view-data.ts` together.
This is a **trace view** available in the eval experiment's case details, not a
dataset view or a replacement for the experiment comparison table. It reads the
case's task/agent/scorer spans, fetches full fields lazily, and provides navigation
to the underlying spans. Timings and call counts come from the agent's task
subtree, excluding the evaluator's judge calls. No separate HTML report or web
service is required.

Check `bt custom-views --help` for the installed version. Node.js is required;
current `bt` releases embed React and the SDK custom-view helpers. Preview with
an **experiment trace URL** containing `r` and/or `s` query parameters (copy it
from an open experiment row):

```bash
bt custom-views trace preview ./product-journey.trace-view.tsx --url '<experiment-trace-url>' --no-open
bt custom-views push ./product-journey.trace-view.tsx --project '<configured-project>' --yes
```

Preview against a real experiment case and check summary, dimensions, null
applicability, tool counts, and span navigation before pushing. The view is
read-only and makes no independent API calls: Braintrust supplies authenticated
field access. Push publishes the saved view to the selected project. Keep the
slug `product-journey-review` stable. By default an existing slug causes an error;
use `--if-exists replace` when updating this same view within the user's scope.
Do not overwrite an unrelated view with a colliding slug.

Open the experiment case, select **Views → Product journey review**, and share
that trace URL. Braintrust records the selected saved view in `tv`; retain the
existing experiment path and trace-selection parameters. The push result may link
to project logs, which is the view's project destination, not the eval's data
source. A trace view works on experiment rows; use the standard experiment table
for comparisons across cases and experiments. Opening a view does not rescore
older runs: missing score cards are hidden, while explicitly inapplicable checks
appear as small explanatory labels (for example, "No docs needed").

Keep the view focused on conclusions and evidence: colored score/measurement
cards, a compact outcome checklist, and expandable evidence grouped by source.
Use span navigation for the underlying trace; do not duplicate its raw
input/output or tool-call listing. Do not add a manual refresh control: reopening
the case loads its current scorer results without rerunning the agent.

Scoring data stays in Braintrust. Local result JSON is an optional debugging
export only when `FLOW_RESULTS_DIR` is explicitly set; it is not used by the view.

Keep recoverable friction in the structured `friction` array even on successful
runs. When a fetch tool summarizes pages, quotes attest to the **tool's returned
text**, not necessarily verbatim page content. Corroborate important claims at
the source before treating them as product defects.

Return the saved view and experiment/trace links, what happened, actionable findings,
and remaining uncertainty. If no real run was possible, provide the runnable eval
and the precise blocker; do not present sample content as measured results.

For broader coverage, add personas and journeys and set `FLOW_TRIALS` explicitly;
the starter runs one case at a time to avoid shared-browser conflicts. Keep case
IDs, criteria, and scorer versions stable when comparing experiments. State trial
counts, environment exclusions, and the effects of changing public content. A
remote Braintrust dataset can hold stable case specifications for repeat runs.
Opening an existing experiment for analysis does not require rerunning agents.

For platform-driven runs, check `bt eval --dev --help` and the current Braintrust
remote-eval documentation. A local dev eval requires a reachable, running worker
with the agent CLI, browser tools, and credentials; uploading cases alone does not
make a hosted agent runner. Project-log online scoring is a separate workflow
and is not needed for these experiment scorers. Configure schedules or recurring
automation only when the user requests them.

References: [CLI](https://www.braintrust.dev/docs/reference/cli/quickstart),
[coding-agent tracing](https://github.com/braintrustdata/braintrust-coding-agent-plugins),
[evaluations](https://www.braintrust.dev/docs/evaluate).
Custom-view reference: [trace views and CLI publishing](https://docs.braintrust.dev/annotate/custom-views#push-views-from-the-cli).
