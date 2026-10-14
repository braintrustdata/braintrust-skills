---
name: braintrust-evaluator-workflow
description: Create, test, refine, deploy, rewind, and visualize Braintrust evaluators (scorers and classifiers) interactively. Use when a user asks to build or improve an evaluator, apply it to production logs with an online-scoring rule, backfill results, or review results.
---

# Braintrust evaluator workflow

## What is an evaluator

An evaluator is a saved function that assesses traces. A scorer produces a numeric score between 0 and 1; a classifier produces categorical labels from a known set. Metrics come from instrumentation, while topics are handled by the topics workflow.

## Workflow overview

The process of designing and testing an evaluator is iterative. You get an understanding of a high level goal and look at a few example traces, try to assess them yourself (as an agent), try to reproduce this analysis with an evaluator function,
solicit user feedback to validate that you're aligned, test on more examples, and then use it!

Creating and running evaluators, especially those that involve LLMs, can cost the user money, so it's important to validate each stage before proceeding.

If the `show_in_workspace` tool is available, you can use it throughout the process to display work to the user and solicit their feedback. Prefer `show_in_workspace` over links embedded in your responses. Otherwise, use permalinks to Braintrust resources to
guide the user to the relevant resources.

Follow the stages defined below in order. Share the general process upfront so the user knows what they'll be doing and can edit or provide suggestions. Proceed without conversational confirmation through the stages the user's request has already authorized, unless you need clarification. Before an unrequested deployment or rewind, recommend the concrete next action and ask whether the user wants it. Once the action is authorized, rely on the mutating tool's approval UI rather than also asking the user to type a confirmation.

Perform read-only discovery before asking clarifying questions. Treat a broad request to create an evaluator as authorization to inspect relevant project traces and form a grounded recommendation, but not to save, deploy, or rewind it. Do not ask the user for fields, labels, examples, or scope that you can infer from the available data, and do not invent a generic taxonomy before inspecting examples. Ask only about genuine product or judgment ambiguities that remain after discovery.

## 1. Understand scope

First, use `sql_query` to find representative data in the current project and inspect the relevant spans and surrounding traces. Identify where the behavior to evaluate appears in `input`, `output`, `metadata`, or other fields rather than asking the user to locate it for you. Then understand the high level goal of the evaluator and whether it requires looking at an individual span, trace, or group. For example, if you are measuring failures for a specific tool call type or an individual LLM call, that would be scoped to a span.
If you need to look across spans, you are usually looking at a trace. Sometimes, you need to consider multiple traces at once, eg. to see multiple steps of a conversation history. In this case, you'll create a group-scoped evaluator that uses a key in the data,
like `metadata.conversation_id`, to connect related traces. If you need, you should download a few traces using the SQL tool and inspect their contents, especially their metadata fields, to understand what grouping fields are available.

When in doubt, the safest default is trace.

## 2. Ground the evaluator in examples

Assess the high level goal of the evaluator against a handful of observed traces or spans. Build a representative set that includes a variety of score values or classifications and ambiguous edge cases. Derive a candidate rubric or label taxonomy from those examples and the user's stated goal; do not offer a generic default taxonomy detached from the data. Record the expected result and rationale for each example. Do not make up examples.

## 3. Milestone: problem clarity

At this point, you should have a clear understanding of:

- Scope: span, trace, or group, including the grouping field for group scope
- Evaluator kind and output contract: scorer with its numeric mapping and skip behavior, or classifier with its allowed labels and no-match behavior
- Decision criteria or rubric
- Representative expected judgments with rationales, including ambiguous cases

Present the grounded recommendation and representative judgments to the user. If any of these points remain unclear, ask a focused question that includes your recommendation and the evidence behind it; do not hand discovery back to the user with an open-ended request for labels or field names. If available, use `show_in_workspace` with `trace_review_batch` to show the examples and collect corrections.

## 4. Crafting the evaluator

You have two fundamental options for creating an evaluator: code or LLM. You should use code for heuristics that do not require an LLM call to parse, for example whether a string is present in the output. Code evaluators can be implemented in Python or TypeScript. Users often have
a preference, which you should follow if they mostly use one language or the other in their project for other functions or have expressed a preference. Otherwise, you can pick one based on the vibes of the conversation.

If you need to do any sort of reasoning or judgement to evaluate the output, you should use an LLM evaluator. LLM evaluators allow you to parse the data ahead of time (using a special function type called a `preprocessor`), and so they are capable of solving a wide variety
of problems.

A preprocessor converts raw span data into the representation exposed to an LLM evaluator as `{{preprocessed}}`. For trace and group inputs, it runs independently on each source span. The system then merges top-level array items in trace order and exact-deduplicates them.

### Crafting good LLM evaluators

#### Using variables

Each LLM evaluator accepts messages which can be templated using mustache variables. Span scoped evaluators use fields like `input`, `output`, and `metadata` directly. You can access their subfields as needed, like `input.name`.

Trace and group evaluators can reference a summarized version of the conversation using the `{{preprocessed}}` variable. By default, `{{preprocessed}}` contains the output of the project's default preprocessor, which is usually a deduplicated list
of messages across turns. This is an excellent default for giving you the conversation history in a turn.

#### Custom preprocessors

In some cases, you may want to parse the trace yourself before presenting it to an LLM. For example, if you only want the LLM to look at certain span types or a specific subfield across spans, you can use an existing or write your
own preprocessor and attach it to the evaluator. Preprocessors are TypeScript code run in QuickJS. A custom preprocessor runs independently on each source span and has no cross-span state. Return atomic top-level array items, such as `{role, content}` messages, rather than one joined transcript string per span; the system merges those items in trace order and exact-deduplicates them. Test the preprocessor with `test_preprocessor_on_trace` before attaching it to the evaluator.

#### General guidance

- It is better to return classes (eg. "unclear", "consistent", "lacking_citation") than numbers (eg 0.4, 0.6, 0.8) directly from an LLM. LLM-based scorers allow you to map classes to numeric scores, and focus the LLM on generating semantic classes.
- Default to using cheaper models (like gpt-6-luna) over frontier class models. If you cannot get accurate performance with a cheaper model, use a more expensive one.
- Jev is TypeSafe's evaluator model: `jev-latest` with configured TypeSafe credentials, or `braintrust/jev-latest` through built-in inference. Prefer configured credentials when both are available.

## 5. Test and refine the evaluator before saving

Call `test_evaluator` with `function: {inline_evaluator: <definition>}`, using the same evaluator definition accepted by `create_evaluator`, and representative inputs. Inputs can be canonical span, trace, or group references, or inline evaluator rows containing fields such as `input`, `output`, `expected`, and `metadata`. Use inline rows with only the fields the evaluator needs when testing extracted examples. Inline code must define a top-level function named `handler`; do not export a differently named function. The evaluator does not need to be saved first. Test it on individual examples and iterate before saving it.
If it works, that's great! Proceed to the next step. If not, then you can try inspecting the output (especially for example, rationale for the LLM judges), adjusting the definition or choice of model, and iterating. If you feel like you are
getting stuck or encountering genuine ambiguity, you can solicit feedback from the user.

## 6. Save it

Use `create_evaluator` to save the evaluator. Set `evaluator.output_type` to `score` for numeric score outputs or `classification` for categorical label outputs. For an LLM score evaluator, provide `choice_scores`; for an LLM classification evaluator, provide `choices` without arbitrary numeric mappings. Code evaluators use `output_type` to declare their output behavior but do not use `choice_scores` or `choices`.

When you create an evaluator, it is now available to use, but it is not automatically deployed into an online scoring rule. We will cover that below, after some additional testing.

Use `show_in_workspace` with `type: "evaluator"` to show the saved evaluator to the user.

## 7. Test it on a few examples

Once you save the evaluator, call `test_evaluator` with `function: {function_id: "<saved function id>"}` and a handful of representative canonical references or inline evaluator rows. This is a good way to make sure the save worked and the actual content / configuration of the saved evaluator
matches what you were testing before.

## 8. Align on the rule

Evaluators can be used ad-hoc, for offline evals (while running experiments), or online (against logs). If the user has not specified the intended use, ask whether they want to use it ad-hoc, in offline evals, or in an online-scoring rule. Do not assume they want online deployment.

If they are not intending to use it online, you are done with this skill.

## 9. Implement the rule

The rule takes in a scope, filters, and sampling rate. You should ask the user if they have a preference on how to filter and sample if they haven't specified. We want to make sure not to turn it onto 100% sampling without their
permission, for example, because that could cost a lot of money. If they've already specified their preference, though, you can proceed.

Call `update_online_scoring_rule` with `operation: "save"`, the saved evaluator `function_ids`, scope, filters, sampling rate, and logging behavior. New rules default to `status: "paused"`; pass `status: "active"` only when the user has already authorized processing new traffic. When updating an existing rule, omit `status` to preserve its current lifecycle state unless the user requested a change. Show the rule with `show_in_workspace` and `type: "automation"`.

If you are creating an evaluator for a pattern, then update the pattern to remove its fulfilled recommendation and attach its preview in `evidence.monitors`. Use the saved function ID when generating its permalink.

Validate the monitor with a bounded `sql_query` without `force_ignore_linter`, using label counts for a classifier. The results might be valid if a backfill hasn't yet occurred. Whether or not a backfill has happened, you should still update the pattern (this is orthogonal from the pattern's definition as it will at least apply to future traffic).

## 10. Estimate, rewind, and monitor

Treat activation for new traffic and historical rewind as separate actions. Do not infer authorization for one from authorization for the other. A rule must be active before it can be rewound. After the user authorizes activation, call `set_automation_status` with the rule's `automation_id` and `status: "active"` before calling `update_online_scoring_rule` with `operation: "rewind"`.

Before rewinding, use `sql_query` to estimate how many eligible targets the exact rule configuration and proposed time window will cover. Count spans for span scope, distinct traces for trace scope, and distinct grouping values for group scope. Account for the sampling rate when reporting the approximation.

If the user requested a natural-language window such as “the past few days,” choose the corresponding inclusive start time without asking them to confirm the timestamp. State the plan directly, for example: “I’ll rewind the last three full days, which should score approximately 1,400 spans,” then call the mutating tool. Its approval UI is the confirmation surface. Only ask a follow-up question when the requested window is genuinely ambiguous enough to change the outcome materially.

After the user separately authorizes historical processing, verify that the rule is active, then call `update_online_scoring_rule` with `operation: "rewind"`, the rule's `automation_id`, and the inclusive `start_time` once. Do not resubmit the rewind to check progress. If the rule is paused, explain that rewind requires activation and ask whether the user wants to activate it; never rewind first and activate later.

After rewinding the active rule, use `show_in_workspace` to show the automation again with `wait_for_progress.min_processed_rows` set to `100`. Before calling it, tell the user that historical reprocessing has started, that the workspace progress bar refreshes every 30 seconds, and that you will continue automatically after 100 rows are processed or the rewind completes, whichever happens first. The presentation tool remains pending while the client monitors the automation; do not call `wait` or poll with other tools.

## 11. Visualize results

When the workspace presentation tool resumes, check whether it resumed because 100 rows were processed or because the rewind completed. Inspect the available score results immediately; do not ask the user to tell you when processing finishes. If the rewind is still running, analyze the first scored sample and make clear that the aggregate is preliminary.

Summarize the score or label distribution and inspect representative passes, failures, and borderline cases. Recommend the most useful refinement or rollout action and ask whether the user wants you to take it.

If another view would be more useful, preview an appropriate chart with `generate_monitor_chart`:

- use a histogram for score distribution;
- use a time series for score trends;
- group by a meaningful category only when it improves interpretation.

Keep the preview unsaved unless the user asks to persist it. If they do, save it with the Monitoring tools and show the resulting Monitoring view using `show_in_workspace`.
