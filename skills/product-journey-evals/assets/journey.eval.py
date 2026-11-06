"""Copy alongside journey.py and cases.json, then run with bt eval."""

import json
import os
from pathlib import Path
import subprocess
import sys

from braintrust import Eval

sys.path.insert(0, str(Path(__file__).resolve().parent))
from journey import run_journey, save_record, score_result
from assertions import evaluate_assertions, RUBRIC


HERE = Path(__file__).resolve().parent
CONTEXT = json.loads(subprocess.check_output(["bt", "status", "--json"], text=True))
PROJECT = os.environ.get("FLOW_PROJECT") or CONTEXT.get("project")
if not PROJECT:
    raise ValueError("Select a Braintrust project or set FLOW_PROJECT")

CASES = json.loads((HERE / "cases.json").read_text())
AGENT = os.environ.get("FLOW_AGENT", "claude")
EXTRA_ARGS = json.loads(os.environ.get("FLOW_AGENT_ARGS", "[]"))
if not isinstance(EXTRA_ARGS, list) or not all(isinstance(a, str) for a in EXTRA_ARGS):
    raise ValueError("FLOW_AGENT_ARGS must be a JSON array of strings")


def task(input, hooks):
    record = run_journey(
        input,
        parent=hooks.span.export(),
        trace_url=hooks.span.permalink(),
        agent=AGENT,
        model=os.environ.get("FLOW_MODEL"),
        timeout=float(os.environ.get("FLOW_TIMEOUT_SECONDS", "180")),
        extra_args=EXTRA_ARGS,
    )
    record["trial_index"] = hooks.trial_index
    record["prompt_revision"] = "2"
    if os.environ.get("FLOW_RESULTS_DIR"):
        save_record(record, os.environ["FLOW_RESULTS_DIR"])
    return record


def journey_scores(output):
    return [{"name": name, "score": score,
             "metadata": {"basis": "visitor self-report; corroborate against tool spans"}}
            for name, score in score_result(output).items()]


def assertion_scores(input, output, expected=None):
    results = evaluate_assertions(input, output, expected)
    output["assertions"] = results
    output["scores"].update({r["name"]: r["score"] for r in results})
    if os.environ.get("FLOW_RESULTS_DIR"):
        save_record(output, os.environ["FLOW_RESULTS_DIR"])
    return results


Eval(
    PROJECT,
    experiment_name=os.environ.get("FLOW_EXPERIMENT_NAME"),
    project_id=CONTEXT.get("project_id") if not os.environ.get("FLOW_PROJECT") else None,
    data=CASES,
    task=task,
    scores=[journey_scores, assertion_scores],
    trial_count=int(os.environ.get("FLOW_TRIALS", "1")),
    max_concurrency=1,
    metadata={"workflow": "product-journey-evals", "prompt_revision": "2", "agent": AGENT,
              "rubric_version": RUBRIC["version"], "rubric_source": RUBRIC["source"],
              "judge_model": os.environ.get("FLOW_JUDGE_MODEL", "gpt-5.4"),
              "model": os.environ.get("FLOW_MODEL", "agent default")},
)
