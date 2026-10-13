# Go: redact conversations at Braintrust's exporter boundary

Follow the [general workflow](../SKILL.md#workflow). This preset replaces whole conversation values, not just detected PII. Captured errors and status descriptions are **preserved by default**; the optional add-on below redacts them only when explicitly selected.

## Setup and application integration

Use the latest published Go SDK and a Go installation compatible with its module requirements. OpenAI instrumentation is a **separate module**; installing only the root Braintrust module is not enough:

```bash
# Only in a new module; skip this in an existing application.
go mod init pii-scrubbing-go
# Resolve current releases; retain go.mod and go.sum in your application.
go get github.com/braintrustdata/braintrust-sdk-go@latest github.com/braintrustdata/braintrust-sdk-go/trace/contrib/openai@latest github.com/openai/openai-go@latest
mkdir -p cmd/pii-smoke
```

Save both complete source files below in `cmd/pii-smoke/`, **not beside an existing application `main.go`**. Then run:

```bash
go mod tidy
go run ./cmd/pii-smoke
```

For app reuse, move the policy to a normal package such as `internal/scrub`, change its package declaration, and export `RedactSpan`. Register it on the application's existing Braintrust client before creating spans. Preserve existing customizers and place redaction after content-enriching callbacks. The integration imports are:

```go
import (
	braintrust "github.com/braintrustdata/braintrust-sdk-go"
	"github.com/braintrustdata/braintrust-sdk-go/config"
	traceopenai "github.com/braintrustdata/braintrust-sdk-go/trace/contrib/openai"
	"github.com/openai/openai-go"
	"github.com/openai/openai-go/option"
)
```

Use `braintrust.WithSpanCustomizers(config.SpanCustomizer{OnSpanExport: scrub.RedactSpan})` in `braintrust.New(tp, ...)`, keeping your existing authentication and destination. Wire provider calls with `openai.NewClient(option.WithMiddleware(traceopenai.NewMiddleware(traceopenai.WithTracerProvider(tp))))`. Pass the parent span's context into the OpenAI call. An explicit tracer provider avoids depending on global OTel registration. The runnable example below demonstrates the same setup with local endpoints.

Checking the `err` returned by `braintrust.New` is ordinary **startup failure handling**, not interception of scrubber-hook failures. Leave hook failure behavior to the SDK; this policy adds no recovery, logging, fallback, or custom error handling.

## Policy and scope

`config.SpanCustomizer.OnSpanExport` receives a completed `sdktrace.ReadOnlySpan` at the Braintrust exporter boundary, after filtering and before attachment processing/upload and serialization. This is not an `OnEnd` processor attempting to mutate a live span. The same key rules apply to **span attributes and event attributes**:

| Keys | Replacement |
| --- | --- |
| Exact `braintrust.input_json`, `braintrust.output_json`, `gen_ai.input.messages`, `gen_ai.output.messages`, `gen_ai.system_instructions`, `llm.input_messages`, `llm.output_messages` | JSON-encoded string `"[REDACTED]"`, including quotes |
| Exact `braintrust.input`, `braintrust.output`, `input`, `output`, `gen_ai.prompt`, `gen_ai.completion`, `llm.prompts`, `llm.completions` | Plain string `[REDACTED]` |
| Dotted descendants of `gen_ai.input.messages.`, `gen_ai.output.messages.`, `gen_ai.system_instructions.`, `gen_ai.prompt.`, `gen_ai.completion.`, `llm.input_messages.`, `llm.output_messages.`, `llm.prompts.`, `llm.completions.` | Plain string `[REDACTED]` |

Encoding follows the attribute schema, not whether a particular value happens to parse as JSON. Whole values are replaced without JSON parsing or recursive traversal. Absent attributes remain absent. Copy-on-write preserves SDK-owned snapshots; IDs, parents, routing, timestamps, metrics, metadata, error/exception attributes, and status survive by default.

Additionally, events named exactly `gen_ai.user.message`, `gen_ai.assistant.message`, `gen_ai.system.message`, or `gen_ai.tool.message` have their existing `content` attribute replaced with the plain marker. Events named exactly `gen_ai.choice` have their existing `message` attribute replaced with the JSON marker. All events still receive the canonical key policy above; unrelated `content` and `message` attributes are unchanged. No absent event fields are invented.

Braintrust ingestion uses unsuffixed `braintrust.input` / `braintrust.output` values directly, but JSON-decodes the `_json` aliases. Named GenAI events can become separate log rows, so attribute-prefix matching alone is insufficient. GenAI attributes can remain metadata depending on ingestion settings; a scalar JSON marker is not a message array and can yield null input/output. Do not synthesize conversation fields to conceal that mapping difference.

**Optional captured-error add-on:** explicitly register `redactSpanWithErrors` instead of `redactSpan`. It additionally replaces exact `braintrust.error_json` with the JSON marker; exact `braintrust.error`, exact `error`, and all `error.` / `exception.` descendants with the plain marker; and nonempty status descriptions with the plain marker. Status codes remain unchanged. This changes exported captured-error content, not hook failure handling.

**Outside this policy:** span/event names, links, resources, scope, tracestate, metadata, tags, context, expected values, arbitrary attributes, and aliases not listed above. Retained fields must themselves be safe. Evaluations may store sensitive expected values or scorer metadata. Other exporters, application logs, provider requests/responses, datasets, feedback, and already-exported data are not changed. Attachments in replaced conversation fields are removed before attachment processing; attachments in other fields remain outside scope. This is not a guarantee of PII-free spans.

## `cmd/pii-smoke/scrubber.go`

The default entry point is conversation-only. The separate error entry point is opt-in.

```go
package main

import (
	"slices"
	"strings"

	"go.opentelemetry.io/otel/attribute"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
)

const redacted = "[REDACTED]"
const redactedJSON = `"[REDACTED]"`

type redactedSpan struct {
	sdktrace.ReadOnlySpan
	attrs  []attribute.KeyValue
	events []sdktrace.Event
	status sdktrace.Status
}

func (s *redactedSpan) Attributes() []attribute.KeyValue { return s.attrs }
func (s *redactedSpan) Events() []sdktrace.Event         { return s.events }
func (s *redactedSpan) Status() sdktrace.Status          { return s.status }

func replacement(key string, includeErrors bool, eventName string) (string, bool) {
	switch eventName {
	case "gen_ai.user.message", "gen_ai.assistant.message", "gen_ai.system.message", "gen_ai.tool.message":
		if key == "content" {
			return redacted, true
		}
	case "gen_ai.choice":
		if key == "message" {
			return redactedJSON, true
		}
	}
	switch key {
	case "braintrust.input_json", "braintrust.output_json",
		"gen_ai.input.messages", "gen_ai.output.messages", "gen_ai.system_instructions",
		"llm.input_messages", "llm.output_messages":
		return redactedJSON, true
	case "braintrust.input", "braintrust.output", "input", "output",
		"gen_ai.prompt", "gen_ai.completion", "llm.prompts", "llm.completions":
		return redacted, true
	}
	for _, prefix := range [...]string{
		"gen_ai.input.messages.", "gen_ai.output.messages.", "gen_ai.system_instructions.",
		"gen_ai.prompt.", "gen_ai.completion.", "llm.input_messages.", "llm.output_messages.",
		"llm.prompts.", "llm.completions.",
	} {
		if strings.HasPrefix(key, prefix) {
			return redacted, true
		}
	}
	if includeErrors {
		switch key {
		case "braintrust.error_json":
			return redactedJSON, true
		case "braintrust.error", "error":
			return redacted, true
		}
		if strings.HasPrefix(key, "error.") || strings.HasPrefix(key, "exception.") {
			return redacted, true
		}
	}
	return "", false
}

func scrubAttributes(attrs []attribute.KeyValue, includeErrors bool, eventName string) ([]attribute.KeyValue, bool) {
	var result []attribute.KeyValue
	for i, attr := range attrs {
		if value, covered := replacement(string(attr.Key), includeErrors, eventName); covered {
			if attr.Value.Type() == attribute.STRING && attr.Value.AsString() == value {
				continue
			}
			if result == nil {
				result = slices.Clone(attrs)
			}
			result[i] = attr.Key.String(value)
		}
	}
	if result == nil {
		return attrs, false
	}
	return result, true
}

func redactSpan(span sdktrace.ReadOnlySpan) (sdktrace.ReadOnlySpan, error) {
	return scrubSpan(span, false), nil
}

func redactSpanWithErrors(span sdktrace.ReadOnlySpan) (sdktrace.ReadOnlySpan, error) {
	return scrubSpan(span, true), nil
}

func scrubSpan(span sdktrace.ReadOnlySpan, includeErrors bool) sdktrace.ReadOnlySpan {
	attrs, changed := scrubAttributes(span.Attributes(), includeErrors, "")
	events := span.Events()
	var copiedEvents []sdktrace.Event
	for i, event := range events {
		if eventAttrs, eventChanged := scrubAttributes(event.Attributes, includeErrors, event.Name); eventChanged {
			if copiedEvents == nil {
				copiedEvents = slices.Clone(events)
			}
			copiedEvents[i].Attributes = eventAttrs
		}
	}
	if copiedEvents != nil {
		events = copiedEvents
		changed = true
	}
	status := span.Status()
	if includeErrors && status.Description != "" && status.Description != redacted {
		status.Description = redacted
		changed = true
	}
	if !changed {
		return span
	}
	return &redactedSpan{ReadOnlySpan: span, attrs: attrs, events: events, status: status}
}
```

## `cmd/pii-smoke/main.go`

This uses the real Braintrust exporter and real OpenAI middleware. Only the HTTP endpoints are local: a stub provider responds to an actual OpenAI SDK request, and a receiver decodes actual gzip/protobuf OTLP HTTP export. Synthetic credentials never leave the local servers; there are no paid model calls or Braintrust uploads. The smoke explicitly runs both the default policy and the optional error policy.

```go
package main

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"sync"
	"time"

	braintrust "github.com/braintrustdata/braintrust-sdk-go"
	"github.com/braintrustdata/braintrust-sdk-go/config"
	traceopenai "github.com/braintrustdata/braintrust-sdk-go/trace/contrib/openai"
	"github.com/openai/openai-go"
	"github.com/openai/openai-go/option"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	oteltrace "go.opentelemetry.io/otel/trace"
	collectortrace "go.opentelemetry.io/proto/otlp/collector/trace/v1"
	commonpb "go.opentelemetry.io/proto/otlp/common/v1"
	tracepb "go.opentelemetry.io/proto/otlp/trace/v1"
	"google.golang.org/protobuf/proto"
)

func require(ok bool, message string) {
	if !ok {
		panic(message) // Do not print captured payloads in assertion failures.
	}
}

func attrMap(attrs []*commonpb.KeyValue) map[string]*commonpb.AnyValue {
	result := make(map[string]*commonpb.AnyValue, len(attrs))
	for _, attr := range attrs {
		result[attr.Key] = attr.Value
	}
	return result
}

func run(includeErrors bool) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	var mu sync.Mutex
	var captured []*tracepb.Span
	var captureErr error
	providerRequests := 0
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/apikey/login":
			w.Header().Set("Content-Type", "application/json")
			_, _ = fmt.Fprintf(w, `{"org_info":[{"id":"local-org","name":"local-org","api_url":%q,"proxy_url":%q}]}`, server.URL, server.URL)
			return
		case "/v1/chat/completions":
			mu.Lock()
			providerRequests++
			mu.Unlock()
			w.Header().Set("Content-Type", "application/json")
			_, _ = io.WriteString(w, `{"id":"chatcmpl-local","object":"chat.completion","created":1,"model":"gpt-4o-mini","choices":[{"index":0,"message":{"role":"assistant","content":"reply alice@example.com"},"finish_reason":"stop"}],"usage":{"prompt_tokens":7,"completion_tokens":3,"total_tokens":10}}`)
			return
		case "/otel/v1/traces":
		default:
			mu.Lock()
			captureErr = errors.New("unexpected local HTTP request")
			mu.Unlock()
			http.NotFound(w, r)
			return
		}
		var reader io.Reader = r.Body
		if r.Header.Get("Content-Encoding") == "gzip" {
			decoded, err := gzip.NewReader(r.Body)
			if err != nil {
				w.WriteHeader(http.StatusBadRequest)
				return
			}
			defer decoded.Close()
			reader = decoded
		}
		body, err := io.ReadAll(reader)
		message := &collectortrace.ExportTraceServiceRequest{}
		if err == nil {
			err = proto.Unmarshal(body, message)
		}
		mu.Lock()
		defer mu.Unlock()
		if err != nil {
			captureErr = errors.New("cannot decode OTLP request")
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		for _, group := range message.ResourceSpans {
			for _, scope := range group.ScopeSpans {
				captured = append(captured, scope.Spans...)
			}
		}
		w.Header().Set("Content-Type", "application/x-protobuf")
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	tp := sdktrace.NewTracerProvider()
	hook := redactSpan
	if includeErrors { // Explicit opt-in for the second verification run only.
		hook = redactSpanWithErrors
	}
	client, err := braintrust.New(tp,
		braintrust.WithAPIKey("local-test-not-a-secret"),
		braintrust.WithAPIURL(server.URL), braintrust.WithAppURL(server.URL),
		braintrust.WithOrgName("local-org"), braintrust.WithProjectID("local-project"),
		braintrust.WithFilterAISpans(false), braintrust.WithEnableTraceConsoleLog(false),
		braintrust.WithSpanCustomizers(config.SpanCustomizer{OnSpanExport: hook}),
	)
	require(err == nil, "SDK initialization failed")
	tracer := client.Tracer("pii-smoke")
	rootCtx, root := tracer.Start(ctx, "support.root")
	root.SetAttributes(attribute.String("braintrust.metadata", `{"category":"support"}`))

	provider := openai.NewClient(
		option.WithAPIKey("local-provider-key"), option.WithBaseURL(server.URL+"/v1/"),
		option.WithMiddleware(traceopenai.NewMiddleware(traceopenai.WithTracerProvider(tp))),
	)
	response, err := provider.Chat.Completions.New(rootCtx, openai.ChatCompletionNewParams{
		Model:    openai.ChatModelGPT4oMini,
		Messages: []openai.ChatCompletionMessageParamUnion{openai.UserMessage("alice@example.com")},
	})
	require(err == nil, "local provider call failed")
	require(len(response.Choices) == 1 && response.Choices[0].Message.Content == "reply alice@example.com", "application response changed")

	// Explicit fixtures are independent of replacement(): do not derive expectations
	// by calling the policy being tested. Exercise each family on spans AND events.
	jsonKeys := []string{
		"braintrust.input_json", "braintrust.output_json",
		"gen_ai.input.messages", "gen_ai.output.messages", "gen_ai.system_instructions",
		"llm.input_messages", "llm.output_messages",
	}
	plainKeys := []string{
		"braintrust.input", "braintrust.output",
		"input", "output", "gen_ai.prompt", "gen_ai.completion", "llm.prompts", "llm.completions",
		"gen_ai.input.messages.0.content", "gen_ai.output.messages.0.content", "gen_ai.system_instructions.0.content",
		"gen_ai.prompt.0.content", "gen_ai.completion.0.content", "llm.input_messages.0.message.content",
		"llm.output_messages.0.message.content", "llm.prompts.0", "llm.completions.0",
	}
	keepKeys := []string{"braintrust.expected", "braintrust.context_json", "input_tokens", "input.extra", "llm.prompts_extra", "gen_ai.input.messages_extra", "safe.category", "content", "message"}
	errorKeys := []string{"braintrust.error", "braintrust.error_json", "error", "error.message", "error.details", "exception.message", "exception.stacktrace", "exception.type", "exception.cause"}
	attrs := make([]attribute.KeyValue, 0, len(jsonKeys)+len(plainKeys)+len(keepKeys)+len(errorKeys))
	for _, keys := range [][]string{jsonKeys, plainKeys, keepKeys, errorKeys} {
		for _, key := range keys {
			value := `{"private":"alice@example.com"}`
			if key == "braintrust.error" {
				value = "captured alice@example.com"
			}
			attrs = append(attrs, attribute.String(key, value))
		}
	}
	_, fixture := tracer.Start(rootCtx, "policy.fixture")
	fixture.SetAttributes(attrs...)
	fixture.SetAttributes(attribute.Int("gen_ai.usage.input_tokens", 7))
	fixture.AddEvent("policy.event", oteltrace.WithAttributes(attrs...))
	fixture.RecordError(errors.New("captured alice@example.com"))
	for _, name := range []string{"gen_ai.user.message", "gen_ai.assistant.message", "gen_ai.system.message", "gen_ai.tool.message"} {
		fixture.AddEvent(name, oteltrace.WithAttributes(
			attribute.String("content", "alice@example.com"),
			attribute.String("message", "unrelated"),
			attribute.String("braintrust.input", "alice@example.com"),
			attribute.Int("safe.count", 2),
		))
	}
	fixture.AddEvent("gen_ai.choice", oteltrace.WithAttributes(
		attribute.String("message", `{"role":"assistant","content":"alice@example.com"}`),
		attribute.String("content", "unrelated"),
		attribute.String("braintrust.output_json", `"alice@example.com"`),
	))
	fixture.AddEvent("unrelated.event", oteltrace.WithAttributes(
		attribute.String("content", "unchanged content"),
		attribute.String("message", "unchanged message"),
	))
	fixture.AddEvent("gen_ai.user.message", oteltrace.WithAttributes(attribute.Int("safe.count", 3)))
	fixture.SetStatus(codes.Error, "captured alice@example.com")
	fixture.End()
	root.End()
	require(tp.ForceFlush(ctx) == nil, "SDK flush failed")
	require(tp.Shutdown(ctx) == nil, "SDK shutdown failed")

	mu.Lock()
	defer mu.Unlock()
	require(captureErr == nil && providerRequests == 1, "local transport failed")
	require(len(captured) == 3, "expected root, provider, and fixture spans")
	byName := make(map[string]*tracepb.Span)
	var providerSpan *tracepb.Span
	for _, span := range captured {
		byName[span.Name] = span
		require(span.EndTimeUnixNano >= span.StartTimeUnixNano && span.StartTimeUnixNano > 0, "timestamps lost")
		require(attrMap(span.Attributes)["braintrust.parent"].GetStringValue() == "project_id:local-project", "routing changed")
		if span.Name != "support.root" && span.Name != "policy.fixture" {
			providerSpan = span
		}
	}
	r, f := byName["support.root"], byName["policy.fixture"]
	require(r != nil && f != nil && providerSpan != nil, "missing exported span")
	for name, original := range map[string]oteltrace.Span{"support.root": root, "policy.fixture": fixture} {
		wire := byName[name]
		require(hex.EncodeToString(wire.TraceId) == original.SpanContext().TraceID().String(), "trace ID changed")
		require(hex.EncodeToString(wire.SpanId) == original.SpanContext().SpanID().String(), "span ID changed")
	}
	require(bytes.Equal(f.ParentSpanId, r.SpanId) && bytes.Equal(providerSpan.ParentSpanId, r.SpanId) && len(r.ParentSpanId) == 0, "parent relationship changed")
	pa := attrMap(providerSpan.Attributes)
	require(pa["braintrust.input_json"].GetStringValue() == `"[REDACTED]"` && pa["braintrust.output_json"].GetStringValue() == `"[REDACTED]"`, "instrumented conversation not redacted")
	require(pa["braintrust.metrics"] != nil, "provider metrics missing")
	ra := attrMap(r.Attributes)
	require(ra["input"] == nil && ra["braintrust.input_json"] == nil && ra["braintrust.output_json"] == nil, "absent conversation fields invented")
	require(ra["braintrust.metadata"].GetStringValue() == `{"category":"support"}`, "metadata changed")
	check := func(got map[string]*commonpb.AnyValue) {
		for _, key := range jsonKeys {
			require(got[key].GetStringValue() == `"[REDACTED]"`, "JSON conversation marker mismatch")
		}
		for _, key := range plainKeys {
			require(got[key].GetStringValue() == "[REDACTED]", "plain conversation marker mismatch")
		}
		for _, key := range keepKeys {
			if key == "braintrust.context_json" {
				// The SDK adds span_origin before export; preserve user context.
				var value map[string]any
				err := json.Unmarshal([]byte(got[key].GetStringValue()), &value)
				require(err == nil && value["private"] == "alice@example.com", "user context changed")
			} else {
				require(got[key].GetStringValue() == `{"private":"alice@example.com"}`, "out-of-scope attribute changed")
			}
		}
		for _, key := range errorKeys {
			want := `{"private":"alice@example.com"}`
			if key == "braintrust.error" {
				want = "captured alice@example.com"
			}
			if includeErrors {
				want = "[REDACTED]"
				if key == "braintrust.error_json" {
					want = `"[REDACTED]"`
				}
			}
			require(got[key].GetStringValue() == want, "captured-error policy mismatch")
		}
	}
	fa := attrMap(f.Attributes)
	check(fa)
	require(fa["gen_ai.usage.input_tokens"].GetIntValue() == 7, "safe metric changed")
	require(len(f.Events) == 9 && f.Events[0].Name == "policy.event" && f.Events[1].Name == "exception", "events changed")
	check(attrMap(f.Events[0].Attributes))
	for i, name := range []string{"gen_ai.user.message", "gen_ai.assistant.message", "gen_ai.system.message", "gen_ai.tool.message"} {
		event := f.Events[i+2]
		got := attrMap(event.Attributes)
		require(event.Name == name, "conversation event name changed")
		require(got["content"].GetStringValue() == "[REDACTED]" && got["braintrust.input"].GetStringValue() == "[REDACTED]", "named conversation event leaked")
		require(got["message"].GetStringValue() == "unrelated" && got["safe.count"].GetIntValue() == 2, "unrelated event attribute changed")
	}
	choice := attrMap(f.Events[6].Attributes)
	require(f.Events[6].Name == "gen_ai.choice" && choice["message"].GetStringValue() == `"[REDACTED]"`, "choice event leaked")
	require(choice["content"].GetStringValue() == "unrelated" && choice["braintrust.output_json"].GetStringValue() == `"[REDACTED]"`, "choice attribute policy mismatch")
	unrelated := attrMap(f.Events[7].Attributes)
	require(f.Events[7].Name == "unrelated.event" && unrelated["content"].GetStringValue() == "unchanged content" && unrelated["message"].GetStringValue() == "unchanged message", "unrelated event content changed")
	absent := attrMap(f.Events[8].Attributes)
	require(f.Events[8].Name == "gen_ai.user.message" && absent["content"] == nil && absent["message"] == nil && absent["safe.count"].GetIntValue() == 3, "absent event fields invented")
	wantError := "captured alice@example.com"
	wantType := "*errors.errorString"
	if includeErrors {
		wantError, wantType = "[REDACTED]", "[REDACTED]"
	}
	ea := attrMap(f.Events[1].Attributes)
	require(ea["exception.message"].GetStringValue() == wantError && ea["exception.type"].GetStringValue() == wantType, "recorded exception policy mismatch")
	require(f.GetStatus().GetCode() == tracepb.Status_STATUS_CODE_ERROR && f.GetStatus().GetMessage() == wantError, "status policy mismatch")
	fmt.Printf("PASS Go: conversation redacted; captured-error add-on=%t; provider, IDs, parents, routing, metadata and metrics checked\n", includeErrors)
}

func main() {
	run(false)
	run(true)
}
```

The two runs check transport output, not private SDK readback APIs. Errors deliberately contain the synthetic email and remain present in the default run; uncovered fixture attributes remain present in both runs. Do not replace the field-specific checks with a blanket claim that the entire payload is PII-free. This smoke covers non-streaming chat instrumentation, not every provider API, attachment upload, evaluator-created span, retry, or hook failure. In an application, use its existing Go test framework for policy unit tests, including independent positive/negative fixtures and default-versus-opt-in error behavior.

## Sources

- [Go SDK package](https://pkg.go.dev/github.com/braintrustdata/braintrust-sdk-go)
- [OpenAI instrumentation package](https://pkg.go.dev/github.com/braintrustdata/braintrust-sdk-go/trace/contrib/openai)
- [Go SDK repository](https://github.com/braintrustdata/braintrust-sdk-go)
