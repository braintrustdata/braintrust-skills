"""Exercise trace propagation, failures, scoring and report safety without live agents."""

import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1] / "skills" / "product-journey-evals"
sys.path.insert(0, str(ROOT / "assets"))
import journey
import assertions




class JourneyTest(unittest.TestCase):
    def setUp(self):
        self.case = json.loads((ROOT / "assets" / "cases.json").read_text())[0]["input"]
        self.result = {
            "summary": "Located instructions",
            "criteria": [{"id": c["id"], "status": "met", "evidence": [0]}
                         for c in self.case["criteria"]],
            "evidence": [{"url": self.case["url"], "observation": "Read quickstart", "quote": "Python"}],
            "blockers": [],
        }

    def runner(self, command, cwd, timeout):
        self.assertEqual(command[:7], ["bt", "trace", "run", "--parent", "opaque-parent", self.agent, "--"])
        if self.agent == "codex":
            output = Path(command[command.index("--output-last-message") + 1])
            output.write_text(json.dumps(self.result))
            events = [{"type": "item.completed", "item": {"id": "web-1", "type": "web_search", "query": "docs"}},
                      {"type": "turn.completed"}]
        else:
            events = [{"type": "assistant", "message": {"content": [
                {"type": "tool_use", "id": "web-1", "name": "WebFetch", "input": {"url": self.case["url"]}}]}},
                {"type": "user", "message": {"content": [{"type": "tool_result", "tool_use_id": "web-1", "content": "Python"}]}},
                {"type": "result", "structured_output": self.result}]
        return 0, False, "\n".join(json.dumps(e) for e in events), ""

    def run_agent(self, agent="claude", runner=None):
        self.agent = agent
        return journey.run_journey(self.case, "opaque-parent", "https://www.braintrust.dev/trace",
                                   agent=agent, runner=runner or self.runner)

    def test_adapters_propagate_parent_and_parse_their_outputs(self):
        for agent in ["claude", "codex"]:
            with self.subTest(agent=agent):
                record = self.run_agent(agent)
                self.assertEqual(record["scores"]["completion"], 1)
                self.assertNotIn("opaque-parent", json.dumps(record))
                self.assertFalse(record["trace_verified"])

    def test_bad_evidence_and_duplicate_criteria_fail_validation(self):
        self.result["criteria"][0]["evidence"] = [100]
        self.assertEqual(self.run_agent()["scores"]["execution_ok"], 0)
        self.result["criteria"][0]["evidence"] = [0]
        self.result["criteria"][1]["id"] = self.result["criteria"][0]["id"]
        self.assertEqual(self.run_agent()["scores"]["execution_ok"], 0)

    def test_timeout_and_nonzero_are_not_product_failures(self):
        for code, timed_out in [(1, False), (-15, True)]:
            record = self.run_agent(runner=lambda *_: (code, timed_out, "", "private diagnostic"))
            self.assertEqual(record["scores"]["execution_ok"], 0)
            self.assertIsNone(record["scores"]["completion"])
            self.assertNotIn("private diagnostic", json.dumps(record))

    def test_product_failure_vs_environment_exclusion(self):
        self.result["criteria"][0]["status"] = "unmet"
        self.assertEqual(self.run_agent()["scores"]["completion"], 0)
        self.result["blockers"] = [{"category": "environment", "description": "No browser",
                                    "impact": "Cannot proceed", "recovery": "None", "evidence": [0]}]
        self.assertIsNone(self.run_agent()["scores"]["completion"])

    def test_schema_mismatch_is_recorded(self):
        self.result["summary"] = 42
        self.assertEqual(self.run_agent()["scores"]["execution_ok"], 0)

    def test_recovered_friction_preserves_success(self):
        self.result["friction"] = [{"category": "product", "description": "Extra navigation",
                                    "impact": "One more page", "recovery": "Followed link", "evidence": [0]}]
        record = self.run_agent()
        self.assertEqual(record["scores"]["completion"], 1)

    def test_real_process_timeout(self):
        with tempfile.TemporaryDirectory() as scratch:
            code, timed_out, _, _ = journey.run_bounded(
                [sys.executable, "-c", "import time; time.sleep(30)"], scratch, 0.05)
        self.assertTrue(timed_out)
        self.assertNotEqual(code, 0)


    def test_tools_are_counted_from_events_not_prose(self):
        events = [
            {"type": "assistant", "message": {"content": [{"type": "text", "text": "WebFetch WebSearch Bash"}]}},
            {"type": "assistant", "message": {"content": [{"type": "tool_use", "id": "a", "name": "Read"}]}},
            {"type": "assistant", "message": {"content": [{"type": "tool_use", "id": "a", "name": "Read"}]}},
            {"type": "result"},
        ]
        capture = journey.capture_thread("\n".join(json.dumps(e) for e in events), "claude")
        record = {"execution": "ok", "capture": capture, "elapsed_seconds": 90}
        self.assertEqual(capture["tool_call_count"], 1)
        self.assertEqual(assertions.code_scores(record)["used_web_tools"], 0)
        capture = journey.capture_thread("\n".join(json.dumps(e) for e in events), "claude", max_chars=10)
        self.assertEqual(capture["status"], "partial")

    def test_rubric_labels_and_dx(self):
        from types import SimpleNamespace
        seen = []
        def judge(name, spec, model):
            def evaluate(**kwargs):
                seen.append(kwargs)
                label = {"task_completed": "PARTIAL", "setup_friction": "NONE", "doc_quality": "AVAILABLE_GAPS",
                         "errors": "RECOVERED"}[name]
                return SimpleNamespace(metadata={"choice": label, "rationale": "Evidence: web-1"})
            return SimpleNamespace(eval=evaluate)
        record = self.run_agent()
        results = assertions.evaluate_assertions(self.case, record, {"private": "expectation",
            "dx_weights": {"task_completed": .4, "setup_friction": .2, "doc_quality": .2, "errors": .2}}, judge_factory=judge)
        scores = {a["name"]: a["score"] for a in results}
        self.assertEqual(scores["task_completed"], 0.4)
        self.assertAlmostEqual(scores["dx"], 0.4 * .4 + .2 + .7 * .2 + .6 * .2)
        self.assertEqual(scores["doc_quality"], .7)
        self.assertEqual(scores["used_web_tools"], 1)
        self.assertIn('"tool_use"', seen[0]["output"])
        self.assertIn("expectation", seen[0]["input"])
        self.assertNotIn("expectation", journey.visitor_prompt(self.case))

    def test_missing_capture_and_judge_failure_are_na(self):
        def fail(*args):
            raise RuntimeError("Provider unavailable")
        record = self.run_agent()
        results = assertions.evaluate_assertions(self.case, record, judge_factory=fail)
        self.assertTrue(all(a["score"] is None for a in results if a["name"] in assertions.JUDGES or a["name"] == "dx"))
        del record["capture"]
        results = assertions.evaluate_assertions(self.case, record, judge_factory=fail)
        self.assertTrue(all(a["score"] is None for a in results))

    def test_case_specific_assertions_and_weights(self):
        from types import SimpleNamespace
        selected = []
        def judge(name, spec, model):
            selected.append(name)
            return SimpleNamespace(eval=lambda **kwargs: SimpleNamespace(metadata={"choice": next(iter(spec["choices"]))}))
        record = self.run_agent()
        results = assertions.evaluate_assertions(self.case, record, expected={
            "optional_assertions": ["journey_clarity"],
            "assertions": {"activation": {"choices": {"ACTIVATED": 1, "NOT_ACTIVATED": 0},
                                          "rubric": "Check the case's observed activation outcome."}},
            "dx_weights": {"task_completed": .5, "activation": .5},
        }, judge_factory=judge)
        self.assertIn("journey_clarity", selected)
        self.assertIn("activation", selected)
        self.assertEqual(next(a["score"] for a in results if a["name"] == "dx"), 1)

    def test_prompt_uses_authorized_case_actions(self):
        case = dict(self.case, allowed_actions=["Complete onboarding in the provisioned test account."])
        prompt = journey.visitor_prompt(case)
        self.assertIn("Complete onboarding in the provisioned test account.", prompt)
        self.assertNotIn("This starter is READ ONLY", prompt)

    def test_invalid_case_assertions_fail_before_judging(self):
        configurations = [
            {"dx_weights": {"missing": 1}},
            {"assertions": {"activation": {"choices": {"YES": 2}, "rubric": "Activation"}}},
            {"assertions": {"speed": {"choices": {"YES": 1}, "rubric": "Speed"}}},
        ]
        for expected in configurations:
            with self.subTest(expected=expected), self.assertRaises(ValueError):
                assertions.evaluate_assertions(self.case, self.run_agent(), expected,
                    judge_factory=lambda *_: self.fail("Invalid config reached a judge"))

    def test_docs_not_needed_is_inapplicable_but_missing_needed_docs_scores_zero(self):
        from types import SimpleNamespace
        for doc_label, expected_score in [("NOT_NEEDED", None), ("MISSING_OR_UNUSABLE", 0)]:
            def judge(name, spec, model):
                label = doc_label if name == "doc_quality" else next(iter(spec["choices"]))
                return SimpleNamespace(eval=lambda **kwargs: SimpleNamespace(metadata={"choice": label}))
            results = assertions.evaluate_assertions(self.case, self.run_agent(),
                {"dx_weights": {"speed": 1, "doc_quality": 1}}, judge_factory=judge)
            docs = next(a for a in results if a["name"] == "doc_quality")
            aggregate = next(a for a in results if a["name"] == "dx")
            self.assertEqual(docs["score"], expected_score)
            self.assertEqual(docs["metadata"]["applicable"], doc_label != "NOT_NEEDED")
            self.assertEqual(aggregate["score"], 1 if doc_label == "NOT_NEEDED" else .5)

    def test_no_default_composite_and_unscorable_docs_are_not_excluded(self):
        from types import SimpleNamespace
        def judge(name, spec, model):
            label = "UNSCORABLE" if name == "doc_quality" else next(iter(spec["choices"]))
            return SimpleNamespace(eval=lambda **kwargs: SimpleNamespace(metadata={"choice": label}))
        results = assertions.evaluate_assertions(self.case, self.run_agent(), judge_factory=judge)
        self.assertNotIn("dx", {a["name"] for a in results})
        results = assertions.evaluate_assertions(self.case, self.run_agent(),
            {"dx_weights": {"speed": 1, "doc_quality": 1}}, judge_factory=judge)
        self.assertIsNone(next(a["score"] for a in results if a["name"] == "dx"))


    def test_deterministic_thresholds(self):
        self.assertEqual(assertions.linear_score(8, 8, 30), 1)
        self.assertEqual(assertions.linear_score(19, 8, 30), .5)
        self.assertEqual(assertions.linear_score(30, 8, 30), 0)
        self.assertEqual(assertions.linear_score(180, 60, 300), .5)

    def test_judge_preserves_selected_braintrust_org(self):
        with patch.dict('os.environ', {"BRAINTRUST_API_KEY": "test-key", "BRAINTRUST_ORG_NAME": "Test Org",
                                       "BRAINTRUST_API_URL": "https://api.braintrust.dev"}, clear=True):
            judge = assertions.default_judge("setup_friction", assertions.JUDGES["setup_friction"], "gpt-5.4")
        self.assertEqual(judge.client.default_headers["x-bt-org-name"], "Test Org")
        self.assertEqual(str(judge.client.base_url), "https://api.braintrust.dev/v1/proxy/")

    def test_optional_export_updates_same_local_record(self):
        record = self.run_agent()
        with tempfile.TemporaryDirectory() as directory:
            first = journey.save_record(record, directory)
            record["assertions"] = [{"name": "task_completed", "score": .4,
                                     "metadata": {"choice": "PARTIAL", "rationale": "<script>"}}]
            record["scores"]["task_completed"] = .4
            self.assertEqual(journey.save_record(record, directory), first)
            self.assertEqual(len(list(Path(directory).glob("*.json"))), 1)


if __name__ == "__main__":
    unittest.main()
