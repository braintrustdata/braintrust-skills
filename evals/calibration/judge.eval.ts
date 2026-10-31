import { Eval } from "braintrust";
import { config, experimentMetadata } from "../lib/config.js";
import { judge } from "../lib/judge.js";

// Known outcomes validate the grader, independently of the skill being evaluated.
const cases: {
  input: { criteria: string[]; evidence: unknown };
  expected: boolean;
}[] = [
  {
    input: {
      criteria: [
        "The summary preserves the stated average latency comparison across assistant versions; it does not replace that metric with p95.",
      ],
      evidence: {
        task: "Summarize the recorded intent into one sentence.",
        input: "Compare average latency across two assistant versions",
        output: "Compare average latency across two assistant versions.",
      },
    },
    expected: true,
  },
  {
    input: {
      criteria: [
        "The summary preserves the stated average latency comparison across assistant versions; it does not replace that metric with p95.",
      ],
      evidence: {
        task: "Summarize the recorded intent into one sentence.",
        input: "Compare average latency across two assistant versions",
        output: "Compare p95 latency across two assistant versions.",
      },
    },
    expected: false,
  },
  {
    input: {
      criteria: [
        "Returns exactly NONE when the input states no identifiable task.",
      ],
      evidence: { input: "Do the thing", output: "NONE" },
    },
    expected: true,
  },
  {
    input: {
      criteria: [
        "The claim of successful tracing is supported by the observed spans.",
      ],
      evidence: { spans: [], output: "Tracing is verified and working." },
    },
    expected: false,
  },
  {
    input: {
      criteria: [
        "Accurately reports the verification limitation without inventing a trace link.",
      ],
      evidence: {
        spans: [],
        credentials: false,
        output:
          "Credentials are unavailable, so live delivery remains unverified.",
      },
    },
    expected: true,
  },
  {
    input: {
      criteria: [
        "Removes specific version identifiers while preserving the p95 latency comparison.",
      ],
      evidence: {
        input: "Compare p95 latency for versions ab-test-829 and ab-test-831",
        output: "Compare p95 latency for versions ab-test-829 and ab-test-831.",
      },
    },
    expected: false,
  },
];

Eval(config.project, {
  experimentName: "mcp-judge-calibration",
  data: cases,
  maxConcurrency: config.concurrency,
  metadata: { ...experimentMetadata, suite: "judge-calibration" },
  task: (input) => judge(input.criteria, input.evidence),
  scores: [
    ({ output, expected }) => ({
      name: "JudgeAgreement",
      score: Number(output.passed === expected),
      metadata: { verdict: output },
    }),
  ],
});
