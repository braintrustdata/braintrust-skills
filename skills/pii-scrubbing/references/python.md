# Python PII scrubbing

This guide replaces conversation fields only; errors, metadata, status and metrics remain unchanged. Choose one integration below, register the policy before producing spans, and keep it installed through flush/shutdown. Error redaction is a separate opt-in below, not error handling for hook failures.

## Setup

Use the latest published packages in your application's environment:

```bash
python3 -m venv .venv
.venv/bin/python -m pip install --upgrade \
  'braintrust[otel]' openai opentelemetry-instrumentation-openai
```

Sources: [Braintrust package](https://pypi.org/project/braintrust/), [Braintrust SDK](https://github.com/braintrustdata/braintrust-sdk-python), [OpenAI instrumentation package](https://pypi.org/project/opentelemetry-instrumentation-openai/), [OpenLLMetry repository](https://github.com/traceloop/openllmetry).

Choose the native **or** OTel integration for a provider call, not both. Reuse your application's existing logger/provider rather than installing a duplicate export path.

## Conversation policies

Save as `scrubbers.py`. Both classes use the real SDK `SpanCustomizer` hook; no custom exporter is needed.

```python
import json

from braintrust import SpanCustomizer

REDACTED = "[REDACTED]"
JSON_REDACTED = json.dumps(REDACTED)
JSON_FIELDS = frozenset({
    "braintrust.input_json", "braintrust.output_json",
    "gen_ai.input.messages", "gen_ai.output.messages", "gen_ai.system_instructions",
    "llm.input_messages", "llm.output_messages",
})
TEXT_FIELDS = frozenset({
    "braintrust.input", "braintrust.output",
    "input", "output", "gen_ai.prompt", "gen_ai.completion",
    "llm.prompts", "llm.completions",
})
PREFIXES = (
    "gen_ai.input.messages.", "gen_ai.output.messages.", "gen_ai.system_instructions.",
    "gen_ai.prompt.", "gen_ai.completion.",
    "llm.input_messages.", "llm.output_messages.", "llm.prompts.", "llm.completions.",
)
CONTENT_EVENTS = frozenset({
    "gen_ai.user.message", "gen_ai.assistant.message",
    "gen_ai.system.message", "gen_ai.tool.message",
})


def scrub_attributes(attributes):
    return {
        key: JSON_REDACTED if key in JSON_FIELDS else
        REDACTED if key in TEXT_FIELDS or key.startswith(PREFIXES) else value
        for key, value in attributes.items()
    }


def scrub_event(event):
    attributes = scrub_attributes(event["attributes"])
    if event["name"] in CONTENT_EVENTS and "content" in attributes:
        attributes["content"] = REDACTED
    if event["name"] == "gen_ai.choice" and "message" in attributes:
        attributes["message"] = JSON_REDACTED
    return {**event, "attributes": attributes}


class RedactNativeConversation(SpanCustomizer):
    def on_span_export(self, data):
        result = dict(data)
        for field in ("input", "output"):
            if field in result:
                result[field] = REDACTED
        return result


class RedactOtelConversation(SpanCustomizer):
    def on_span_export(self, data):
        return {
            **data,
            "attributes": scrub_attributes(data["attributes"]),
            "events": [scrub_event(event) for event in data["events"]],
        }
```

Native records can be incremental: missing fields stay missing, and input-only/output-only updates are scrubbed independently. Whole-field replacement also removes attachments in those fields before native attachment processing. Application inputs and provider return values are not changed.

OTel hooks receive detached **dictionaries**, not `ReadableSpan` instances: `attributes` is a dictionary; `events` is a list of dictionaries containing `name`, `timestamp`, `attributes`, and `dropped_attributes`. Other snapshot fields include `context`, `parent`, timing, `kind`, `status`, resource/scope metadata, links and dropped-item counts. `status` contains integer `status_code` and optional `description`. The policy preserves these fields and event counters.

JSON-valued attributes receive the JSON string literal `'"[REDACTED]"'`; plain-text exact keys (including unsuffixed `braintrust.input`/`braintrust.output`) and dotted descendants receive `[REDACTED]`. Classification follows the attribute schema, never whether the original value happens to parse as JSON. The same key rules apply to span and event attributes. Additionally, events named `gen_ai.user.message`, `gen_ai.assistant.message`, `gen_ai.system.message` or `gen_ai.tool.message` have their present `content` replaced with the plain marker; `gen_ai.choice` has its present `message` replaced with the JSON marker. Unrelated event content is unchanged; absent fields remain absent.

There is no blanket `gen_ai.*` match: model, usage and latency attributes survive. Names, arbitrary metadata, resource/scope attributes, links, separate OTel logs and other fields are outside this policy. Braintrust ingestion can retain `gen_ai.*` attributes as metadata depending on backend flags, and the JSON scalar marker is not a message array: parsed input/output can be null. Do not synthesize extra input/output fields to hide that mapping difference. Span events also become log rows during ingestion, so conversation event bodies must be scrubbed before export, not only their canonical attribute aliases.

## Native

Save as `native_app.py`. Set `BRAINTRUST_API_KEY`, `BRAINTRUST_PROJECT` and `OPENAI_API_KEY` for normal use. `wrap_openai` creates the LLM child span; the root is the application's task span.

```python
import os

from braintrust import init_logger, set_span_customizers, wrap_openai
from openai import OpenAI

from scrubbers import RedactNativeConversation


def run(*, client=None, app_url=None, api_key=None):
    set_span_customizers([RedactNativeConversation()])
    logger = init_logger(
        project=os.environ.get("BRAINTRUST_PROJECT", "conversation-scrubbing"),
        app_url=app_url, api_key=api_key,
    )
    client = wrap_openai(client if client is not None else OpenAI())
    messages = [{"role": "user", "content": "Reply briefly to jane@example.com."}]
    with logger.start_span(name="chat-task", type="task") as root:
        root.log(input=messages, metadata={"tenant": "example"})
        response = client.chat.completions.create(
            model=os.environ.get("OPENAI_MODEL", "gpt-4o-mini"), messages=messages,
        )
        root.log(output=response.choices[0].message.content)
    logger.flush()
    return response


if __name__ == "__main__":
    run()
```

`set_span_customizers` replaces the ordered process-wide list; pass synchronous instances, not classes. Include existing customizers in that same list, with redaction after content-enriching hooks. Native records use the configuration active when logged; OTel uses the configuration active at export. Configure before producing spans and keep it installed through flush/shutdown. If one process uses both pipelines, use an explicitly shape-aware combined policy rather than registering the two shape-specific classes together.

## OpenTelemetry

Save as `otel_app.py`. Set `BRAINTRUST_API_KEY`, `BRAINTRUST_PARENT` (for example `project_name:conversation-scrubbing`) and `OPENAI_API_KEY`. This example creates one provider for a fresh process. In an existing application, attach `OtelExporter` to its provider and pass that provider to the instrumentor instead of replacing the global provider.

```python
import json
import os

from braintrust import set_span_customizers
from braintrust.otel import OtelExporter
from openai import OpenAI
from opentelemetry.instrumentation.openai import OpenAIInstrumentor
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor

from scrubbers import RedactOtelConversation


def run(*, client=None, url=None, api_key=None, parent=None):
    set_span_customizers([RedactOtelConversation()])
    provider = TracerProvider()
    provider.add_span_processor(BatchSpanProcessor(
        OtelExporter(url=url, api_key=api_key, parent=parent),
    ))
    instrumentor = OpenAIInstrumentor()
    instrumentor.instrument(tracer_provider=provider)
    client = client if client is not None else OpenAI()
    messages = [{"role": "user", "content": "Reply briefly to jane@example.com."}]
    tracer = provider.get_tracer("conversation-scrubbing")
    with tracer.start_as_current_span("chat-task") as root:
        root.set_attribute("braintrust.input_json", json.dumps(messages))
        root.set_attribute("tenant", "example")
        response = client.chat.completions.create(
            model=os.environ.get("OPENAI_MODEL", "gpt-4o-mini"), messages=messages,
        )
        root.set_attribute("braintrust.output_json", json.dumps(response.choices[0].message.content))
    provider.shutdown()
    instrumentor.uninstrument()
    return response


if __name__ == "__main__":
    run()
```

`start_as_current_span` establishes the parent context for the instrumented OpenAI call; do not manufacture a separate manual LLM span. `OpenAIInstrumentor()` uses its default conversation-span-attribute mode and records usage/model attributes. Current releases emit JSON-encoded `gen_ai.input.messages` and `gen_ai.output.messages`; older instrumentation can emit dotted `gen_ai.prompt.N.*` / `gen_ai.completion.N.*` fields. The policy covers both, and the verifier requires actual input and output content markers rather than assuming one schema. The newer `use_attributes=True` keyword is not accepted by all older releases; no constructor override is needed here. If content tracing has been disabled by `TRACELOOP_TRACE_CONTENT=false`, absent conversations stay absent. Do not use the instrumentor's separate log/events export mode expecting a span hook to scrub OTel logs.

`OtelExporter` invokes the shared hook immediately before OTLP serialization, including when used inside `BraintrustSpanProcessor`. Generic `OTLPSpanExporter` does **not** invoke it. Other processors/exporters see the original spans; do not add an unprotected parallel destination.

## Optional: redact captured errors too

Only if requested, append these classes to `scrubbers.py` and explicitly register the matching error customizer **after** the conversation customizer. The default examples above do not enable this add-on.

```python
class RedactNativeErrors(SpanCustomizer):
    def on_span_export(self, data):
        result = dict(data)
        if "error" in result:
            result["error"] = REDACTED
        return result


def scrub_error_attributes(attributes, *, exception_event=False):
    return {
        key: JSON_REDACTED if key == "braintrust.error_json" else
        REDACTED if exception_event or key in {"braintrust.error", "error"} or key.startswith(("error.", "exception.")) else value
        for key, value in attributes.items()
    }


class RedactOtelErrors(SpanCustomizer):
    def on_span_export(self, data):
        status = dict(data["status"])
        if status.get("description") is not None:
            status["description"] = REDACTED
        return {
            **data,
            "attributes": scrub_error_attributes(data["attributes"]),
            "events": [
                {**event, "attributes": scrub_error_attributes(
                    event["attributes"], exception_event=event["name"] == "exception",
                )}
                for event in data["events"]
            ],
            "status": status,
        }


# Explicit opt-in: replace the registration in the selected startup path with:
# set_span_customizers([RedactNativeConversation(), RedactNativeErrors()])
# OR set_span_customizers([RedactOtelConversation(), RedactOtelErrors()])
```

This covers native `error`; OTel error aliases (`braintrust.error` is plain text, only `braintrust.error_json` is JSON encoded), `error.*`/`exception.*` attributes; every attribute on events named `exception`; and status descriptions. It preserves status codes and event names/timestamps. It does not sanitize arbitrary names or metadata.

Hook failures are a different concern. The installed SDK's shared runner strips affected records on hook exceptions or invalid synchronous returns instead of exporting the original content. Native stripping retains identity/routing/protocol fields, `created`, `span_attributes.type`, and `metrics.start/end`, adding `context.customizer_error`; it does **not** preserve token metrics on that failure path. OTel stripping retains identity/timing/routing and adds `braintrust.context_json='{"customizer_error":true}'`, clearing content and resource/scope metadata. The shared diagnostic is limited to one safe message per process without exception details; `KeyboardInterrupt` and `SystemExit` propagate. These are SDK behaviors, not a guarantee about all logging, transport failures or other exporters. Stripping an update cannot retract earlier uploads. No custom exception handler is needed for these policies.

## Verification

Run application-owned policy tests with the project's existing test framework. Use independent fixtures for every exact alias and dotted family, both span and event attributes, plus negative controls such as `gen_ai.usage.input_tokens`, `gen_ai.request.model`, `braintrust.parent`, metadata and unrelated keys. Assert that errors, exception events and status descriptions survive by default and change only when the optional add-on is registered.

For an export-path check without credentials or a paid model call, save the following as `verify_local.py` beside the three files above. It supplies only local HTTP responses; the real OpenAI instrumentation, Braintrust hooks, batch processor and exporters run unchanged. Run each path in a fresh process:

```bash
.venv/bin/python verify_local.py native
.venv/bin/python verify_local.py otel
```

```python
import json
import os
import re
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# Do not inherit a real destination or credentials for this local-only check.
for key in list(os.environ):
    if key.startswith(("BRAINTRUST_", "OTEL_", "OPENAI_", "TRACELOOP_")):
        del os.environ[key]

from openai import OpenAI
from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import ExportTraceServiceRequest

requests = []


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def reply(self, value):
        body = json.dumps(value).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        self.reply({"logs3_payload_max_bytes": 5_000_000})

    def do_POST(self):
        body = self.rfile.read(int(self.headers["Content-Length"]))
        requests.append((self.path, body))
        if self.path == "/api/apikey/login":
            self.reply({"org_info": [{"id": "local-org", "name": "local", "api_url": base}]})
        elif self.path == "/v1/project":
            self.reply({"id": "local-project", "name": "local", "org_id": "local-org"})
        elif self.path.endswith("/chat/completions"):
            self.reply({
                "id": "local-chat", "object": "chat.completion", "created": 0, "model": "local-model",
                "choices": [{"index": 0, "finish_reason": "stop", "message": {
                    "role": "assistant", "content": "Hello jane@example.com",
                }}],
                "usage": {"prompt_tokens": 21, "completion_tokens": 7, "total_tokens": 28},
            })
        elif self.path == "/otel/v1/traces":
            self.send_response(200)
            self.send_header("Content-Length", "0")
            self.end_headers()
        else:
            self.reply({})


server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
threading.Thread(target=server.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{server.server_port}"
client = OpenAI(api_key="local-only", base_url=base + "/v1")
if sys.argv[1] == "native":
    from native_app import run
    response = run(client=client, app_url=base, api_key="local-only")
    rows = [row for path, body in requests if path == "/logs3" for row in json.loads(body)["rows"]]
    assert rows
    llm_ids = {row["span_id"] for row in rows if row.get("span_attributes", {}).get("type") == "llm"}
    assert llm_ids, "Expected an instrumented provider span"
    for span_id in llm_ids:
        updates = [row for row in rows if row.get("span_id") == span_id]
        for field in ("input", "output"):
            assert any(row.get(field) == "[REDACTED]" for row in updates), (span_id, field)
    assert any(row.get("metrics", {}).get("prompt_tokens") == 21 for row in rows)
    for row in rows:
        for field in ("input", "output"):
            if field in row:
                assert row[field] == "[REDACTED]"
    exported = json.dumps(rows).encode()
else:
    from otel_app import run
    response = run(client=client, url=base + "/otel/v1/traces", api_key="local-only", parent="project_name:local")
    spans = []
    for path, body in requests:
        if path == "/otel/v1/traces":
            request = ExportTraceServiceRequest.FromString(body)
            spans.extend(span for resource in request.resource_spans for scope in resource.scope_spans for span in scope.spans)
    assert len(spans) == 2
    root = next(span for span in spans if span.name == "chat-task")
    llm = next(span for span in spans if span is not root)
    assert llm.parent_span_id == root.span_id and llm.trace_id == root.trace_id
    root_attributes = {item.key: item.value for item in root.attributes}
    for key in ("braintrust.input_json", "braintrust.output_json"):
        assert root_attributes[key].string_value == '"[REDACTED]"'
    attributes = {item.key: item.value for item in llm.attributes}
    # Independent expectations: do not import the policy's key lists.
    for direction, legacy in (("input", "prompt"), ("output", "completion")):
        json_key = f"gen_ai.{direction}.messages"
        exact_text_key = f"gen_ai.{legacy}"
        descendants = {
            key: value for key, value in attributes.items()
            if key.startswith((json_key + ".", exact_text_key + "."))
        }
        if json_key in attributes:
            assert attributes[json_key].string_value == '"[REDACTED]"'
        if exact_text_key in attributes:
            assert attributes[exact_text_key].string_value == "[REDACTED]"
        for key, value in descendants.items():
            assert value.string_value == "[REDACTED]", key
        content_keys = [
            key for key in descendants
            if re.search(r"\.(content|text)(\.|$)", key)
        ]
        assert json_key in attributes or exact_text_key in attributes or content_keys, (
            f"Missing {direction} conversation content", sorted(attributes)
        )
    usage = [
        attributes[key].int_value for key in ("gen_ai.usage.input_tokens", "gen_ai.usage.prompt_tokens")
        if key in attributes
    ]
    assert 21 in usage, "Expected preserved provider token usage"
    exported = b"".join(body for path, body in requests if path == "/otel/v1/traces")
assert b"jane@example.com" not in exported
assert response.choices[0].message.content == "Hello jane@example.com"
server.shutdown()
print(sys.argv[1], "local export passed")
```

The loopback check verifies actual native JSON or OTLP protobuf export and an instrumented provider span, not backend ingestion. For your app's complete policy, extend your existing tests with error fixtures, event aliases, incremental updates, identity/routing, and the optional add-on; then separately inspect an authorized staging trace through the supported CLI workflow in the main skill.
