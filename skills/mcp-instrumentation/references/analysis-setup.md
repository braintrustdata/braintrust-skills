# Optional Topics and feedback Patterns

Configure these only for features the user chose. Draft and preview first; ask permission for each save, activation, or historical run. No response is not approval. If integrations are unavailable, give the exact UI steps and prepared prompts rather than claiming setup is complete.

## Intent Topics

Read [Topics](https://docs.braintrust.dev/observe/topics), [custom facets](https://docs.braintrust.dev/observe/topics/custom-facets), and, when available, Braintrust's `braintrust/topics-workflow` skill. Prepare an **MCP intent** facet using [the provided prompt](intent-facet-prompt.txt), with exclusion pattern `^NONE$`.

Confirm the real recorded intent path on fresh traces. A default Thread preprocessor can return nothing for a server-only MCP trace with no LLM messages. Prefer a **facet-specific preprocessor** that extracts only the agreed intent field from selected server tool spans. Do not silently change the project's default preprocessor or feed full arguments/results to this intent-only facet. Return atomic items that can be deduplicated by the Topics pipeline rather than a joined transcript per span.

For the default path, the transformation should read `span.input.telemetry.intent`; adapt it if the schema uses another path. Return an empty collection when the field is absent, blank, or not a string. Preserve meaningful metric and comparison terms. Test the actual preprocessor API with representative stored spans; do not guess its signature or assume inputs are JSON strings. If a trace includes several tools, choose trace or conversation grouping deliberately and confirm that unrelated tasks aren't merged. Exclude feedback spans unless their intents are part of the agreed use-case population.

Preview the preprocessor and full facet on a few real traces, plus missing, blank, vague, and instruction-like intents. Confirm concrete distinctions such as p95 versus average latency survive summarization, and missing/vague cases return `NONE` or the platform's normalized no-match. If every result is skipped or empty, resolve the missing signal before enabling analysis. When there is no traffic yet, provide the prepared configuration and explain that live validation remains.

The `bt` CLI installed during quickstart may support saving the facet:

```bash
bt --help
bt status
bt observability template pull --help
bt observability template push --help
bt topics status --help
```

Verified at authoring time: **`bt observability template push` supports facets**, preprocessors bundled with facets, Topics settings, and Loop automations. `bt topics config topic-map set` edits clustering settings; it isn't a command to create a facet prompt. Do not invent `bt facets push` or `bt patterns` commands.

If using templates, first inspect the target configuration:

```bash
bt observability template pull --project '<project>' --output observability-before.json
```

Use a new output filename if it exists. Build a **narrow template containing only the proposed resources**, following the installed CLI's format. A pull includes existing resources and is not a safe template to replay wholesale. Inspect relevant function/template schemas or use the Braintrust MCP facet tools when the format isn't clear; don't improvise JSON payloads. Prefer `create_preprocessor`, `create_facet`, and `set_topics_automation` when those tools are available and clearer.

Show the exact template/configuration, target project, facet prompt/preprocessor, scope/filter, sampling, cadence, and which topic maps will be created or replaced. Explain any existing-resource changes and obtain approval. Then, where the installed CLI supports it:

```bash
bt observability template push mcp-intent-template.json --project '<project>'
```

Pass `--topics-automation '<name-or-id>'` only after verifying the chosen existing automation is compatible. Avoid `--force` unless the replacement was explicitly reviewed. Inspect the result and read back the configuration, including whether the automation is enabled and the facet is actually attached. A saved facet alone doesn't prove continuous processing is active.

UI fallback: open the target project's **Topics**, select **+ Facet**, enter the name/prompt, configure the tested custom preprocessor and `^NONE$`, preview on traces, and save only after approval. Review the **Apply to existing traces** choice separately; it can trigger work across other automated facets too. Offer historical backfill only with a bounded window and approval of its scope/cost. Topic generation needs sufficient summaries; do not promise immediate clusters.

After setup, report the facet and project links, automation state, preview results, and whether historical processing was approved. Ask before moving to Patterns.

## Feedback Patterns instructions

Read [Patterns](https://docs.braintrust.dev/observe/patterns) and [setup](https://docs.braintrust.dev/observe/patterns/enable). The [bundled investigation prompt](feedback-pattern-instructions.md) is an **automation Instruction**, not a severity/category rubric. It is based on the feedback investigation workflow supplied for this skill, with paths adapted to the recommended message/context schema.

Before presenting it, replace every occurrence of `send_feedback` and `input.message`/`input.context` with the actual tool/span name and recorded paths. For Braintrust's original text schema, use `input.feedback` and omit the nonexistent context reference. Keep discovery anchored to feedback calls while allowing inspection of related triggering traces as evidence. Confirm the installed Braintrust analysis skill identifier; the prompt uses the hosted skill name `braintrust/pattern-analysis`.

Inspect existing automations and patterns before proposing changes. Prefer a clearly named **MCP feedback** Patterns automation with a narrow scope. If the user prefers to extend an existing compatible job, show how its original purpose will be preserved. Use the supported Patterns creation workflow/tool discovered in the current integration, or **Patterns > Settings > New automation**. A generic Loop automation isn't necessarily registered as a Patterns automation. A CLI template that pushes Loop jobs is not proof it configures Patterns identity or rubric artifacts.

Show the final instructions, project, automation, schedule/window, enabled state, and expected model usage. Ask permission before saving/enabling. Leave delivery destinations unset unless requested. Verify the saved instructions and enabled state. Historical investigation or **Run now** is a separate approved action, not implied by saving a prompt.

## Optional severity/category rubric

Offer to prepare and push a rubric **only with the user's approval**. Prefer an automation-specific rubric so feedback priorities don't change unrelated project findings. Read the existing rubric first and show the complete proposed text and target. A minimal starting point, to discuss and adapt:

```markdown
# MCP feedback severity and categories

## Severity
- High: Evidence confirms a material blocker or incorrect result affecting a core supported task, without a practical workaround. Explain impact and scope.
- Medium: Evidence confirms a recurring tool problem or contract confusion with a practical workaround, or a recurring unmet capability with concrete task impact.
- Low: Localized friction with limited observed impact and a straightforward workaround.
- Informational: A useful capability request or report whose impact or suspected cause is not yet verified. Do not infer broad impact from report counts.

## Categories
- `tool_failure`: A supported tool reports an error or malformed result requiring investigation.
- `contract_confusion`: Advertised schemas, parameters, documentation, or error messages mislead callers.
- `missing_capability`: No available tool supports a concrete requested task.
- `unexpected_result`: A successful call returns a result that differs from the reported expectation.

## Evidence
Distinguish reported symptoms from validated causes. Quote reports and corroborating evidence. Count distinct reports within the exact window, exclude labeled synthetic checks, and never present report frequency as the tool failure rate. Keep separate themes separate when they require different fixes.
```

The saved rubric must include a `Categories` heading and entries in the format above. It replaces the target's entire rubric; don't save an investigation prompt into this field.

When available, use `read_patterns_rubric` with explicit project/automation IDs, then `update_patterns_rubric` with the same target, complete approved Markdown, and `expected_version` from the read. An inherited/default automation rubric uses version 0. Re-read and reconcile if the version changed; don't overwrite concurrent changes. Omitting the automation ID on update changes the project rubric, even if a read defaulted to an automation. Always specify the intended automation.

UI fallback: open the feedback Patterns automation's settings, choose **Edit rubric**, review and save. If automation-specific rubrics aren't supported by the deployment, explain the limitation rather than changing the project rubric. Do not claim `bt observability template push` also persists rubric artifacts without verifying support.

Read back any saved rubric and report its scope/version. Ask permission before another configuration change or investigation run. If the user declines analysis, leave them with the verified instrumentation summary and the prepared optional prompts.
