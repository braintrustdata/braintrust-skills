# Product journey evaluation dimensions

Use the case's goal, persona, starting state, allowed actions, and completion
criteria. The same structure applies to onboarding, plan selection, feature use,
support, account configuration, or reading docs. The label-based judge pattern
is informed by [docs-agent-eval at 381ad8d](https://github.com/braintrustdata/docs-agent-eval/blob/381ad8d25d5fc5d938e3e9b6d58cfa2da1ba7f23/src/eval.ts);
this skill's dimensions are defined by `assets/assertions.json`.

| Dimension | Assertion | Measurement |
| --- | --- | --- |
| Setup friction | `setup_friction` | NONE = 1, MINOR = 0.75, HIGH = 0.4, BLOCKED = 0; NOT_REQUIRED = N/A |
| Speed of tasks | `speed` | Each case's duration; 1 at ≤60s, 0 at ≥300s, linear between |
| Tool-call efficiency | `efficiency` | Actual call count; 1 at ≤8 calls, 0 at ≥30, linear between |
| Errors encountered | `errors` | NO_ERRORS = 1, RECOVERED = 0.6, BLOCKING = 0; explanation inventories observed failures |
| Docs availability/quality | `doc_quality` | AVAILABLE_USEFUL = 1, AVAILABLE_GAPS = 0.7, HARD_TO_FIND = 0.4, MISSING_OR_UNUSABLE = 0; NOT_NEEDED = N/A |

## Source of evidence

Timings, tool invocations, and failures belong in the trace. Derive scores and
report explanations from that activity; there is no separate telemetry store or
visitor-supplied counter. The CLI adapters capture native events and task elapsed
time for local scoring, and link the resulting experiment case to the Braintrust
trace. Confirm important findings against those spans.

Count call IDs once, including retries, excluding the structured-output formatting
tool. Do not count tool names appearing in prose. Display each task attempt,
including failed or timed-out attempts, with its measured duration. Such attempts
can have unscored quality/efficiency rather than masquerading as fast successes.
Model/tool/human waiting contributes to elapsed time; interpret it in context.
Thresholds are versioned starting points to calibrate for comparable tasks.

## Setup friction

Assess the prerequisites needed to begin: signup/login, credentials, permissions,
configuration, unclear steps, retries, or required assistance. Distinguish product
obstacles from agent mistakes and missing environment provisioning. A task in an
already provisioned account can have NOT_REQUIRED setup; do not infer that a fresh
user would also have frictionless setup. Respect authorized action boundaries.

## Errors encountered

The judge explanation lists what failed, repeated attempts where visible, severity,
product/agent/environment/unknown attribution, recovery, and supporting tool/span
IDs. Include recovered errors, not just terminal failures. An exit code of zero
does not establish an error-free journey. Normal followed redirects are not
errors. If evidence does not establish a failure, report uncertainty.

## Conditional documentation assessment

Do not force docs lookup into every journey. The judge checks whether docs/help
were needed or consulted in the actual activity. No need and no lookup means
NOT_NEEDED, not a perfect score. If needed docs could not be found or used, assess
that failure; do not mark it inapplicable. Tool/network restrictions that prevent
assessment are UNSCORABLE rather than proof that the product lacks docs.

When applicable, judge availability, discoverability, relevance, correctness, and
whether the guidance let the agent proceed. Do not use page counts alone as a
quality proxy. The visitor should consult help naturally as the task requires.

## Outcome, applicability, and optional assertions

`task_completed` (COMPLETE/PARTIAL/INCOMPLETE) is a supporting outcome check;
`used_web_tools` is a diagnostic. Keep these visible when interpreting speed or
call count so a quick unsuccessful attempt is not mistaken for a good journey.

Missing/truncated capture, insufficient evidence, and judge failures yield N/A.
Explicitly inapplicable labels carry `metadata.applicable = false`; an unscorable
judgment does not imply inapplicability. Explanations should cite actual tool call
or span IDs and remain reviewable model judgments.

Add case-specific dimensions in `expected.assertions` as named objects with
`choices` (numeric scores in [0,1]) and a `rubric`. Keep these evaluator-only:
the visitor receives `input`, not expected answers. For example:

```json
{
  "expected": {
    "completion_evidence": "The test account reaches its activation screen.",
    "assertions": {
      "activation": {
        "choices": {"ACTIVATED": 1, "NOT_ACTIVATED": 0},
        "rubric": "Check the observed account state against this case's activation outcome."
      }
    }
  }
}
```

`journey_clarity` is available through `expected.optional_assertions` for cases
that benefit from an additional navigation/feedback judgment. It is not a default
replacement for the five requested dimensions.

There is no default composite. If requested, `expected.dx_weights` can select
positive weights for judge assertions and/or speed/efficiency. Explicitly
inapplicable setup/docs are excluded, with applied weights retained in metadata.
A missing applicable score leaves the aggregate N/A; do not silently drop a
failed judge's weight. Version dimensions, thresholds, and weights; prior rubric
scores are not directly comparable.

## Reanalyzing evidence

Reuse `capture.thread` with `evaluate_assertions(case, record, expected)` rather
than launching another visitor. For Braintrust-only evidence, fetch the complete
agent subtree with tool/turn inputs, outputs, IDs, errors, and metrics. Exclude
scorer spans and unrelated trials, check pagination, and set capture `basis` to
`Braintrust span rows`. Preserve experiment/task links and label the new run as
reanalysis. Online project scorers and scheduled visits are separate operations;
these assertions already run on each eval case.
