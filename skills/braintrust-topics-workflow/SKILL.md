---
name: braintrust-topics-workflow
description: Topics allow you to discover clusters from traces using a pipeline that involves preprocessing traces (converting raw trace data into a textual representation with JavaScript code), computing facets (using an LLM to convert the preprocessed data into 1-2 sentences), and clustering (using algorithms like HDBSCAN). These clusters are useful for discovering use cases, monitoring failures, and tracking these trends over time. Use when configuring, evaluating, or improving Topics, facets, preprocessors, or Topics automations.
---

# Braintrust Topics workflow

## How topics works

Consider the simplest possible implementation for topics:

- Embed traces
- Cluster the embeddings

Doing this directly, on the raw contents of a trace, is quite tricky. Traces can be millions of tokens, but embedding models have context windows on the order of 8,192 tokens. If you just embed them (even with some clever truncation), you end up with noisy clusters.

Anthropic’s Clio paper suggests a better approach, which is to summarize conversations into "facets" which are specific summaries about a trace, like the use case, sentiment, or issues. You could also imagine more specific facets, like which school subject the trace covers (in the context of an educational app).

Traces can be much more complex than conversations. So to extract the essence of a trace into something an LLM can look at requires some preprocessing. The logic we use to populate the thread view is a great default, but of course, more advanced use cases may have their own. You can even have specific preprocessors paired with specific facets.

So to generate good quality topics, we must:

- Decide whether to scope to a span, trace, or group (eg. all traces with the same `metadata.session_id`)
- Preprocess each set of spans into simple text
- Apply one or more facets to distill the trace into a short, clear summary
- Cluster these facets into topics

Once that's done, the clustering generates a "topic map", which can be efficiently applied to spans, traces, or groups to classify them. You can query and monitor these classifications over time.

## The ideal process

You have a series of tools available to you to configure topics, and in the simplest case, you can just "enable" the topics automation. It will use the default preprocessor, called "thread" (unless the user has overridden the project's default preprocessor). Thread looks at all the LLM calls
in the trace, and then deduplicates them, so you get a coherent trajectory. The built-in facets are Task (the use case), Sentiment (user feelings, positive or negative), and Issues (behavioral issues worth investigating). New automations default to Task. We are starting to recommend people use the new Patterns feature (which
uses a full on agent) to find Issues (sentiment and otherwise). In general, we think that the default topics are useful to get a quick understanding of the feature and the use cases in the project, but to get an in-depth understanding of problems worth solving, you should create custom facets
(and often, custom preprocessors).

When a customer asks for your help with setting up topics, you should:

### Set up sane defaults

You should follow these steps if there are no existing topic automations in the project. If there are, inspect them and reuse one only when its data source, scope and grouping, filter, preprocessor, sampling, topic window, and generation cadence are compatible. Still validate the preprocessor and requested facets on current data.

#### The preprocessor

The job of the preprocessor is to capture a representation of the trace that deduplicates redundant information and captures the essence of what's required to understand its contents. The default preprocessor, called "thread", returns an array of LLM messages in each span (or `[]`
if there are none). The machinery that calls the preprocessor automatically deduplicates redundant items in an array, so when combined, you get a single deduplicated list of messages.

A custom preprocessor runs independently on each source span and has no cross-span state. Return atomic top-level array items, such as `{role, content}` messages, rather than one joined transcript string per span; the system merges those items in trace order and exact-deduplicates them.

Each project has a default preprocessor which can be referenced as `project_default`. The default value of `project_default` is `thread`. This works for most projects, but customers will often trace things in a non-standard format, and `thread` will return a subset of the information
or none at all. Call `get_project_settings` to inspect the configured and effective defaults, then run `project_default` and make sure that you get non-null values. If this looks sensible, then you can move onto the next step.

If not, you will need to create a new preprocessor. You should look at several traces' raw data to try and find the best way to do this. Often users will have LLM messages tucked away in interesting places, or other similar kinds of context available. Make sure to actually run
the preprocessor function that you iterate on to validate that it works (do not just guess).

If you create a custom preprocessor, it should have the following properties:

- Contains user provided inputs, model outputs, tool calls, and errors
- Does not contain superfluous system or debugging information. The minimal representation is just an array of `{"role": "...", "content": "..."}` objects.
- Produces an array of objects that can be deduplicated across spans

Users will often tuck away LLM messages in custom fields that the default preprocessor does not pick up, and if they do, this is a great foundation for a custom preprocessor. Make sure to actually run the preprocessor and look at the outputs. Sift through them for superfluous
information that doesn't necessarily need to be there, and of course, make sure that the key user, assistant, tool, and error content is present. You should also run the `Task` facet on the preprocessor you're working on and make sure that it
returns something sensible (that is a good test of the preprocessor itself).

If you created a custom preprocessor and the project's default preprocessor is `thread` (or not defined), then change the project's default preprocessor to the new one you defined. That way, it will become the default for the existing and new facets.

#### Scoping

Validate whether the analysis should be one trace at a time or if they have conversational / thread context split across traces that needs to be combined with a grouping key. This is often called something like `metadata.conversation_id` (or session id, thread id, group id).
You can look at some traces to try to determine whether there is a grouping key and then provide a recommendation. You can solicit input from the user if needed.

#### Default facets

Try running the Task facet, which will use the project's default preprocessor under the hood. Run it with the selected scope. Validate the outputs look good. If every current preview is `skipped`, empty, or obviously duplicated, treat validation
as failed and do not yet enable topics.

Iterate on the preprocessor until you see good outputs from Task. If the `show_in_workspace` tool is available, use the `show_in_workspace` + `trace_review_batch` workflow to solicit feedback from the user on around 5 traces if possible. Otherwise, share the outputs directly and ask for feedback in your response.

Then, ask the user if they want to enable sentiment and issues. If so, repeat this procedure for each of them.

#### Topics automation

Configure a Topics automation to run with the default preprocessor, the appropriate scope (usually trace or a group), and the chosen default facets.

#### Rewinding

Ask the user if they'd like to rewind it on some historical data. This is usually an hour (for high volume projects) or a day (for lower volume projects).

### Understand what the user would like to monitor

Beyond the sane defaults, we can get into the nitty gritty of why someone wants to use this feature. Zooming out a bit, a coding agent (like you!) can derive a vast superset of the more specific instruments (like topics, scorers, and so on) that you can utilize in Braintrust.
Features like Patterns, which looks at a few hundred traces + runs SQL queries, are quite powerful. However, it is not cost effective, or consistent, to run a full blown agent on every trace at scale. So beyond some ad-hoc exploration and triaging, to actually monitor problems
at scale, you need more precise tools deployed within Braintrust. Braintrust offers:

- Scorers: functions (LLM, TypeScript, or Python) that take a span, trace, or group as input and return a number between 0->1
- Classifiers: functions (LLM, TypeScript, or Python) that take a span, trace, or group as input and return a label
- Facets: functions (LLM-only, with a predefined model) that take a span, trace, or group as input and return a 1-2 sentence summary with respect to some prompt

Facets, which are the cornerstone of Topics, are different because they specifically return unstructured, high-signal information, which helps you _discover_ the clusters in the data. For example, if you have a list of 5 error types, and you want to label them, you probably want
classifiers. But if you want to discover the types of errors in your traces, you need topics.

## Workflow

You should perform this full workflow, and in particular, make sure that you run evals to validate that the topic quality is good. The user may also ask you to add or skip steps, which is fine.

### Understand the goal

First, understand the goal of the topics pipeline. Is it to discover use cases (the "Task" facet)? Or classify errors? Or identify cases where users are unhappy about a new feature?
As you do this, it's useful to understand:

- Scope (span, trace, or group)
- Filters (does this apply to all items, or a subset, eg. `metadata.application = 'foo'`)
- Ground truth outputs

You can generate ground truths on a handful of examples, around 5 (and if needed to disambiguate, up to 10). If the `show_in_workspace` tool is available, use it with `type: "trace_review_batch"` and `review_mode: "description"` to align with the user. Otherwise, present the examples and your proposed ground truths in your response and ask the user to correct them.
You should query a handful of traces using the SQL tools and investigate them to generate these ground truths. Once you align with the user, write out
an output policy, which is essentially a high level facet prompt that describes the intended result. You can share that with the user, and if it feels a bit hairy or full of specific examples, solicit their
feedback to refine it. You should also identify what types of outputs are effectively `null`, meaning they can be ignored by the clustering pipeline downstream.

You also need to figure out which outputs to skip. The default is to ask the LLM to return `NONE` and set something like `^NONE$` as the no-match pattern. However, you should look at what the facet returns and what values would
be unhelpful for clustering. For example, outputs like "no issues" or "neutral" (sentiment) are usually worth skipping since clustering them would not provide insight to the user.

### Define the facet pipeline

Once you align with the user on a good high level facet, you need to engineer a good preprocessor and facet prompt to use with the actual facet model to reproduce (to the best we can) these results. The facet
model is much smaller than you, and so while it's efficient, it is less creative. You might need to spell things out more for it. Ultimately, we will validate this with a more rigorous eval, but you should
craft a preprocessor + facet prompt, and test it on this small handful of reviewed examples until you can reproduce performance. It's also important to test some no match examples, and make sure that regex
is working properly.

First, craft a preprocessor and use your own judgement to try and derive the target facet output from the preprocessed output. You should start with the project's default preprocessor before writing your own. Once you are able to get a good preprocessor working, work on a facet prompt that aims to reproduce it.

If you cannot after a few rounds of trying, you should share this with the user, and collaborate in either better defining the high level goal or refining the preprocessor/prompt until you do. Sometimes, the problem is just too ambiguous or difficult to solve with topics. That is okay if it happens, but it should be rare, and you can use this opportunity to ideally avoid that by iterating on the preprocessor
and facet.

### Create ground truth

At this point, we've established a clear understanding of the user's goal and some evidence that a topics pipeline can produce good facet results (note: we have not validated anything about clustering,
but in practice, good facets => good clusters, so it's mostly important that we generate good facets).

The next step is to test on a larger dataset, and improve the eval results. You should construct a dataset of up to 100 examples (assuming the project has them available). Each `input` in the dataset
should be a span, trace, or group. Sample across time, common traffic, structural variation, edge cases, and likely `NONE` cases. Deduplicate by the stable identity of the selected span, trace, or group.
For a span, trace, or group, store the corresponding reference. Do NOT store preprocessed text.

Span:

```json
{
  "_full_row_id_ref": {
    "object_type": "project_logs",
    "object_id": "<project-id>",
    "row_id": "<span-row-id>",
    "root_span_id": "<root-span-id>"
  }
}
```

Trace:

```json
{
  "trace_ref": {
    "object_type": "project_logs",
    "object_id": "<project-id>",
    "root_span_id": "<root-span-id>"
  }
}
```

Group:

```json
{
  "group_ref": {
    "object_type": "project_logs",
    "object_id": "<project-id>",
    "root_span_ids": ["<root-span-id-1>", "<root-span-id-2>"]
  }
}
```

Leave `expected` unset, then use `run_eval` to run the facet and preprocessor with the same model as the current agent over this dataset.
You should by default use the same model as yourself, but if you don't know which one to use or the user prefers a different one, you can seek
clarification and use that instead.

Use no scorers for this reference run. Spot check a few outputs and make sure they look like you would expect. For subsequent evals, use the
reference experiment as data by passing `{"experiment_name":"<reference-experiment-name>"}` as the dataset; its outputs become the expected values.

The eval task MUST be a facet. If it's a built-in facet, like `Task`, the `task` argument should be:

```json
{
  "global_function": "Task",
  "function_type": "facet"
}
```

When the eval task is an inline facet, wrap the facet definition in `inline_function`. Do not put the facet fields directly under `task` or use `inline_prompt`:

```json
{
  "task": {
    "inline_function": {
      "type": "facet",
      "preprocessor": {
        "type": "inline",
        "code": "<complete JavaScript preprocessor>"
      },
      "prompt": "<facet-prompt>",
      "model": "<model>",
      "no_match_pattern": "^NONE$"
    },
    "function_type": "facet",
    "name": "<facet-name>"
  }
}
```

Omit `preprocessor` to use the project default, or use `{"type":"function","id":"<preprocessor-function-id>"}` to reference a saved preprocessor. Keep `model` inside `inline_function`.

### Eval and iterate

Now, you should run an eval with the facet over this reference experiment. It's important to craft scorers that:

- Always check output validity and no-match correctness with deterministic scorers. Facet execution applies the candidate's `no_match_pattern` and normalizes every matching output to `no_match`; score that normalized value instead of hardcoding source strings such as `NONE` or `Neutral`. `Factuality` does not validate either.
- Compare the facet output with the ground truth using a semantic-agreement scorer. `Factuality` can contribute to semantic agreement.
- If relevant:
  - The facet might be quite categorical and you can see if it fits one of the intended fields.
  - Use-case specific scoring, like sentiment analysis.

These inline Node scorer descriptors provide deterministic defaults when dataset `expected` values are strings:

```json
[
  {
    "inline_context": { "runtime": "node", "version": "22" },
    "code": "function handler({ output }) { return typeof output === \"string\" && output.trim().length > 0 && output !== \"skipped\" ? 1 : 0; }",
    "function_type": "scorer",
    "name": "Valid facet output"
  },
  {
    "inline_context": { "runtime": "node", "version": "22" },
    "code": "function handler({ output, expected }) { if (typeof output !== \"string\" || typeof expected !== \"string\") return 0; const actualNoMatch = output.trim() === \"no_match\"; const expectedNoMatch = expected.trim() === \"no_match\"; return actualNoMatch === expectedNoMatch ? 1 : 0; }",
    "function_type": "scorer",
    "name": "No-match correctness"
  }
]
```

You can use the eval to iterate the facet definition until you get better results. Make sure not to overfit. Run a baseline, then inspect row-level failures after every experiment. State one hypothesis, change one coherent part of the preprocessor or facet, and rerun the same validation slice. Run no more than 5 experiments before reflecting and sharing progress with the user. Run the winning candidate once on the untouched test split.

### Save the winning facet pipeline

Before configuring the automation, save the winning preprocessor with `create_preprocessor` unless it is the unchanged built-in default. Then save the winning facet with `create_facet`, using the evaluated prompt, no-match behavior, and saved preprocessor reference. Re-run a few reviewed examples through the saved facet to confirm that persistence did not change its behavior.

### Configure the topics automation

Now that we have a scope, filters, preprocessor, and facet ready, you can configure a topics automation to run them. Check to see if there are any existing topics automations. Add the facet to an existing automation only when its data source, scope and grouping, filter, sampling, topic window, and generation cadence are compatible. Matching scope and filter alone is insufficient. The benefit of sharing an automation, if the facets share the same preprocessor, is that the facet calls will be batched and therefore cheaper.

Otherwise, you can create a new, clearly named topics automation that has these parameters plugged in appropriately. If multiple automations exist, pass `automation_id` explicitly when updating or rewinding one.

### Rewinding

You should offer to rewind the automation to start populating the project. It will take time for the rewind to complete and generate clusters, so you should not wait for that. You can use SQL queries to estimate how far you should rewind. Generally speaking, you want to get at least 1,000 examples labeled to generate good clusters. Low-volume projects generally require a longer window; high-volume projects can use a shorter one.

Count the eligible span, trace, or group units over the exact scope, filter, and proposed window. Use pilot-eval token usage from the frozen pipeline to estimate each facet the rewind will invoke:

```text
cost_per_call_for_facet_i =
  mean_input_tokens_i / 1,000,000 * $0.05
  + mean_output_tokens_i / 1,000,000 * $0.40

estimated_rewind_cost =
  eligible_units * sampling_rate * sum(cost_per_call_for_facet_i)
```

Present the eligible count, window, token assumptions, base estimate, and a 20% uncertainty buffer. Ask for explicit approval of the window and estimate before calling `rewind_topics_automation`.

## Guidelines

- The tools that modify data are protected by permissions checks, but those checks do not replace explicit approval of an estimated expensive operation.
- Users don't understand this workflow on their own, so presenting them choices and saying ("I did not do [the next step], but I can if you would like") isn't helpful. They want to get good topics, and they don't necessarily know or have an opinion on how (if they express one though, feel free to embrace it).
- Be careful when running expensive operations, like evaluating facets, creating ground truth values for lots of data points, or backfilling the topics pipeline. It's best to ask the user for permission and give them a rough estimate of cost.
- Do not enable topics without testing the facet on the user's data and making sure that it returns something sensible (ideally with their confirmation or review).
