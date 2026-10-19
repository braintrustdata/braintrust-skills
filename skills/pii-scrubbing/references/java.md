# Java: Braintrust SpanCustomizer at the OTel export boundary

Follow the [general workflow](../SKILL.md#workflow). This preset replaces conversation input/output only. Captured errors, exception attributes and status descriptions are preserved unless you explicitly opt into the error add-on below. Hook-failure handling remains SDK-owned.

## Package and scope

Use the latest `dev.braintrust:braintrust-sdk-java` from [Maven Central](https://central.sonatype.com/artifact/dev.braintrust/braintrust-sdk-java). See the [SDK repository](https://github.com/braintrustdata/braintrust-sdk-java) and [OpenAI Java package](https://central.sonatype.com/artifact/com.openai/openai-java). Java's Braintrust tracing pipeline is OpenTelemetry-based: `SpanCustomizer` receives completed `SpanData` before destination grouping, attachment conversion and OTLP serialization.

The policy replaces whole fields on **both spans and events**; it does not inspect JSON or detect emails. Exact JSON-schema keys get the JSON-encoded marker `"[REDACTED]"` (including quotes): `braintrust.input_json`, `braintrust.output_json`, `gen_ai.input.messages`, `gen_ai.output.messages`, `gen_ai.system_instructions`, `llm.input_messages`, `llm.output_messages`.

Exact plain-text keys get `[REDACTED]`: `braintrust.input`, `braintrust.output`, `input`, `output`, `gen_ai.prompt`, `gen_ai.completion`, `llm.prompts`, `llm.completions`. Dotted descendants of `gen_ai.input.messages.`, `gen_ai.output.messages.`, `gen_ai.system_instructions.`, `gen_ai.prompt.`, `gen_ai.completion.`, `llm.input_messages.`, `llm.output_messages.`, `llm.prompts.`, and `llm.completions.` also get the plain marker. Classification follows the attribute schema, not whether the original value parses as JSON.

Event names also carry conversation semantics: on `gen_ai.user.message`, `gen_ai.assistant.message`, `gen_ai.system.message` and `gen_ai.tool.message`, present `content` is replaced with the plain marker; on `gen_ai.choice`, present `message` is replaced with the JSON marker. The canonical attribute rules still apply to every event. Unrelated event `content`/`message` fields remain unchanged.

Backend ingestion uses unsuffixed `braintrust.input`/`braintrust.output` values directly and parses their `_json` counterparts. Events can become separate `type=log` rows, so inspect those rows as well as parent spans. Depending on backend mapping, `gen_ai.*` attributes can remain metadata, and a scalar JSON marker is not a message array: normalized input/output may be null. Do not invent fields to hide this distinction.

Missing fields are not invented. IDs, parents, routing, metrics, metadata, names, resource/scope attributes, links, expected values and unlisted fields are preserved. This is not a claim that every span is PII-free. Other exporters, OTel logs, application logs, dataset rows and feedback are outside this hook's scope.

## Copyable policy

Save as `src/main/java/PiiCustomizer.java`:

```java
import dev.braintrust.trace.SpanCustomizer;
import io.opentelemetry.api.common.AttributeKey;
import io.opentelemetry.api.common.Attributes;
import io.opentelemetry.api.common.AttributesBuilder;
import io.opentelemetry.sdk.trace.data.DelegatingSpanData;
import io.opentelemetry.sdk.trace.data.EventData;
import io.opentelemetry.sdk.trace.data.SpanData;
import io.opentelemetry.sdk.trace.data.StatusData;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;

public final class PiiCustomizer implements SpanCustomizer {
    public static final String REDACTED = "[REDACTED]";
    private static final String JSON_REDACTED = "\"[REDACTED]\"";
    private static final Set<String> JSON_KEYS = Set.of(
            "braintrust.input_json", "braintrust.output_json",
            "gen_ai.input.messages", "gen_ai.output.messages", "gen_ai.system_instructions",
            "llm.input_messages", "llm.output_messages");
    private static final Set<String> TEXT_KEYS = Set.of(
            "braintrust.input", "braintrust.output", "input", "output",
            "gen_ai.prompt", "gen_ai.completion", "llm.prompts", "llm.completions");
    private static final List<String> PREFIXES = List.of(
            "gen_ai.input.messages.", "gen_ai.output.messages.", "gen_ai.system_instructions.",
            "gen_ai.prompt.", "gen_ai.completion.", "llm.input_messages.", "llm.output_messages.",
            "llm.prompts.", "llm.completions.");
    private static final Set<String> MESSAGE_EVENTS = Set.of(
            "gen_ai.user.message", "gen_ai.assistant.message", "gen_ai.system.message", "gen_ai.tool.message");
    private final boolean redactCapturedErrors;

    public PiiCustomizer() { this(false); }
    private PiiCustomizer(boolean redactCapturedErrors) {
        this.redactCapturedErrors = redactCapturedErrors;
    }
    public static PiiCustomizer withCapturedErrors() { return new PiiCustomizer(true); }

    private String replacement(String key, String eventName) {
        if (eventName != null) {
            if (key.equals("content") && MESSAGE_EVENTS.contains(eventName)) return REDACTED;
            if (key.equals("message") && eventName.equals("gen_ai.choice")) return JSON_REDACTED;
        }
        if (JSON_KEYS.contains(key)) return JSON_REDACTED;
        if (TEXT_KEYS.contains(key)) return REDACTED;
        for (String prefix : PREFIXES) {
            if (key.startsWith(prefix)) return REDACTED;
        }
        if (redactCapturedErrors) {
            if (key.equals("braintrust.error_json")) return JSON_REDACTED;
            if (key.equals("braintrust.error") || key.equals("error")
                    || key.startsWith("error.") || key.startsWith("exception.")) return REDACTED;
        }
        return null;
    }

    private Attributes scrubAttributes(Attributes original, String eventName) {
        AttributesBuilder builder = null;
        for (var entry : original.asMap().entrySet()) {
            var key = entry.getKey();
            String marker = replacement(key.getKey(), eventName);
            if (marker != null) {
                if (builder == null) builder = original.toBuilder();
                builder.remove(key); // Remove typed originals before inserting strings.
                builder.put(AttributeKey.stringKey(key.getKey()), marker);
            }
        }
        return builder == null ? original : builder.build();
    }

    @Override
    public SpanData onSpanExport(SpanData span) {
        Attributes attributes = scrubAttributes(span.getAttributes(), null);
        List<EventData> originalEvents = span.getEvents();
        List<EventData> changedEvents = null;
        for (int i = 0; i < originalEvents.size(); i++) {
            EventData event = originalEvents.get(i);
            Attributes cleaned = scrubAttributes(event.getAttributes(), event.getName());
            if (cleaned != event.getAttributes()) {
                if (changedEvents == null) changedEvents = new ArrayList<>(originalEvents);
                changedEvents.set(i, EventData.create(event.getEpochNanos(), event.getName(),
                        cleaned, event.getTotalAttributeCount()));
            }
        }
        List<EventData> events = changedEvents == null ? originalEvents : changedEvents;
        StatusData originalStatus = span.getStatus();
        StatusData status = redactCapturedErrors && !originalStatus.getDescription().isEmpty()
                ? StatusData.create(originalStatus.getStatusCode(), REDACTED) : originalStatus;
        if (attributes == span.getAttributes() && changedEvents == null && status == originalStatus) return span;
        return new DelegatingSpanData(span) {
            @Override public Attributes getAttributes() { return attributes; }
            @Override public List<EventData> getEvents() { return events; }
            @Override public StatusData getStatus() { return status; }
        };
    }
}
```

**Optional captured-error add-on:** replace `new PiiCustomizer()` with `PiiCustomizer.withCapturedErrors()` only when requested. It additionally replaces exact `braintrust.error_json` with the JSON marker; exact `braintrust.error`, exact `error`, and every `error.` / `exception.` descendant on spans/events with the plain marker; and nonempty status descriptions with the plain marker. Status codes, event names and timestamps remain unchanged. Other vendor error fields are not covered. This is redaction of already-captured errors, not error handling for a failed customizer.

The hook is synchronous, performs no I/O, and does not mutate application objects or catch failures. Register it after content-enriching customizers; no later customizer should restore content. The SDK owns handling of thrown exceptions, null results and protected-identity changes: its exporter strips failed-customizer span content and emits `braintrust.context_json` with `{"customizer_error":true}`, retaining identity/duration/routing. Do not implement a fallback that exports the original payload.

## Production registration and provider instrumentation

Save as `src/main/java/TracingBootstrap.java`:

```java
import dev.braintrust.config.BraintrustConfig;
import dev.braintrust.trace.BraintrustTracing;
import io.opentelemetry.api.OpenTelemetry;

public final class TracingBootstrap {
    public static OpenTelemetry initialize() {
        var config = BraintrustConfig.builder()
                .filterAISpans(false) // Include manual/task spans, not just LLM spans.
                .debug(false) // Avoid pre-customization diagnostic span logging.
                .enableTraceConsoleLog(false)
                .addSpanCustomizer(new PiiCustomizer())
                .build();
        return BraintrustTracing.of(config, false);
    }
}
```

Supply `BRAINTRUST_API_KEY` and `BRAINTRUST_DEFAULT_PROJECT_NAME` through your normal secret/environment configuration. `BRAINTRUST_DEFAULT_PROJECT_ID`, when set, takes precedence over the project name. Wrap the provider with the **same** OpenTelemetry instance, rather than creating an unrelated tracing provider. For OpenAI, add `implementation 'com.openai:openai-java:latest.release'` and use:

```java
import com.openai.client.OpenAIClient;
import com.openai.client.okhttp.OpenAIOkHttpClient;
import dev.braintrust.instrumentation.openai.BraintrustOpenAI;
import io.opentelemetry.api.OpenTelemetry;

public final class InstrumentedOpenAI {
    public static OpenAIClient create(OpenTelemetry otel) {
        return BraintrustOpenAI.wrapOpenAI(otel, OpenAIOkHttpClient.fromEnv());
    }
}
```

Use the returned client for application calls. Keep provider lifetime and flush/shutdown in your application's existing lifecycle. If you already own provider builders, use `BraintrustTracing.enable(config, tracerBuilder, loggerBuilder, meterBuilder)` once instead of installing another exporter/provider. A separately initialized Java agent does not inherit this configuration; there is no environment-variable customizer registration.

## Credential-free local verification

The following smoke sends actual SDK OTLP HTTP exports to a loopback server. It checks independent fixtures, default error preservation, opt-in error redaction, IDs, parents, routing and metrics. It also exercises `BraintrustOpenAI.wrapOpenAI` with a local OpenAI HTTP response, without a model call or staging upload. It does not assert that the conversation-only policy removes PII from unrelated fields or errors.

Use a compatible JDK and your existing Gradle wrapper (or install [Gradle](https://gradle.org/)). Save as `build.gradle` in a standalone scratch app:

```groovy
plugins { id 'application' }
repositories { mavenCentral() }
dependencyLocking { lockAllConfigurations() }
dependencies {
    implementation 'dev.braintrust:braintrust-sdk-java:latest.release'
    // These are supplied by Braintrust's published dependency graph.
    implementation 'io.opentelemetry:opentelemetry-api'
    implementation 'io.opentelemetry:opentelemetry-sdk'
    implementation 'io.opentelemetry.proto:opentelemetry-proto:latest.release'
    implementation 'com.openai:openai-java:latest.release'
    runtimeOnly 'org.slf4j:slf4j-simple:latest.release'
}
application { mainClass = 'ScrubberSmoke' }
tasks.named('run') { jvmArgs '-Dorg.slf4j.simpleLogger.defaultLogLevel=warn' }
```

Save `settings.gradle`:

```groovy
rootProject.name = 'braintrust-java-pii-scrubbing'
```

For application policy unit tests, reuse the application's existing framework (for example, JUnit). Capture real `SpanData` with `SdkTracerProvider`, `SimpleSpanProcessor` and a small `SpanExporter`; those APIs are already provided by `opentelemetry-sdk`. No `opentelemetry-sdk-testing` dependency is needed. Do not add a versionless `opentelemetry-sdk-testing` artifact assuming the SDK pins it: it is not a transitive dependency. If your existing tests need it, align it with the resolved OTel SDK using your application's OTel BOM/dependency constraints rather than independently choosing a newer testing version.

Save as `src/main/java/ScrubberSmoke.java`, alongside the policy:

```java
import com.openai.client.okhttp.OpenAIOkHttpClient;
import com.openai.models.chat.completions.ChatCompletionCreateParams;
import com.sun.net.httpserver.HttpServer;
import dev.braintrust.config.BraintrustConfig;
import dev.braintrust.instrumentation.openai.BraintrustOpenAI;
import dev.braintrust.trace.BraintrustTracing;
import io.opentelemetry.api.common.Attributes;
import io.opentelemetry.api.trace.StatusCode;
import io.opentelemetry.context.Context;
import io.opentelemetry.proto.collector.trace.v1.ExportTraceServiceRequest;
import io.opentelemetry.proto.common.v1.AnyValue;
import io.opentelemetry.proto.common.v1.KeyValue;
import io.opentelemetry.sdk.OpenTelemetrySdk;
import java.io.ByteArrayInputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.TimeUnit;
import java.util.stream.Collectors;
import java.util.zip.GZIPInputStream;

public final class ScrubberSmoke {
    private static final String SECRET = "synthetic.person@example.invalid";
    private static final String PROJECT = "11111111-1111-4111-8111-111111111111";
    // Independent fixtures: do not obtain expected keys from PiiCustomizer.
    private static final List<String> JSON_FIELDS = List.of(
            "braintrust.input_json", "braintrust.output_json",
            "gen_ai.input.messages", "gen_ai.output.messages", "gen_ai.system_instructions",
            "llm.input_messages", "llm.output_messages");
    private static final List<String> TEXT_FIELDS = List.of(
            "braintrust.input", "braintrust.output", "input", "output",
            "gen_ai.prompt", "gen_ai.completion", "llm.prompts", "llm.completions",
            "gen_ai.input.messages.0.content", "gen_ai.output.messages.0.content",
            "gen_ai.system_instructions.0.content", "gen_ai.prompt.0.content", "gen_ai.completion.0.content",
            "llm.input_messages.0.message.content", "llm.output_messages.0.message.content",
            "llm.prompts.0", "llm.completions.0");
    private static final List<String> UNTOUCHED = List.of(
            "metadata.input", "input.extra", "braintrust.input_json.extra", "gen_ai.prompting",
            "gen_ai.input.messages_count", "llm.prompts_count", "content", "message");
    private static final List<String> TEXT_ERROR_FIELDS = List.of(
            "braintrust.error", "error", "error.message", "error.stack", "error.type",
            "error.details", "exception.message", "exception.stacktrace", "exception.type", "exception.cause");
    private record Received(String parent, ExportTraceServiceRequest request) {}

    private static void require(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
    }
    private static Map<String, AnyValue> attributes(List<KeyValue> fields) {
        return fields.stream().collect(Collectors.toMap(KeyValue::getKey, KeyValue::getValue));
    }
    private static void checkFields(Map<String, AnyValue> attrs, boolean errors) {
        for (String key : JSON_FIELDS) require("\"[REDACTED]\"".equals(attrs.get(key).getStringValue()), key);
        for (String key : TEXT_FIELDS) require("[REDACTED]".equals(attrs.get(key).getStringValue()), key);
        for (String key : UNTOUCHED) require(SECRET.equals(attrs.get(key).getStringValue()), key);
        require((errors ? "\"[REDACTED]\"" : "\"" + SECRET + "\"")
                .equals(attrs.get("braintrust.error_json").getStringValue()), "captured JSON error");
        for (String key : TEXT_ERROR_FIELDS) {
            require((errors ? "[REDACTED]" : SECRET).equals(attrs.get(key).getStringValue()), key);
        }
    }

    private static void exercise(String base, List<Received> received, boolean errors) throws Exception {
        received.clear();
        var config = BraintrustConfig.builder().apiKey("local-dummy-not-a-secret")
                .apiUrl(base).tracesPath("/otel/v1/traces").defaultProjectId(PROJECT)
                .filterAISpans(false).debug(false).enableTraceConsoleLog(false)
                .addSpanCustomizer(errors ? PiiCustomizer.withCapturedErrors() : new PiiCustomizer()).build();
        String rootId;
        String traceId;
        String childId;
        try (var otel = (OpenTelemetrySdk) BraintrustTracing.of(config, false)) {
            var tracer = otel.getTracer("pii-smoke");
            var root = tracer.spanBuilder("manual.root").setNoParent().startSpan();
            rootId = root.getSpanContext().getSpanId();
            traceId = root.getSpanContext().getTraceId();
            var fixture = Attributes.builder();
            for (String key : JSON_FIELDS) fixture.put(key, SECRET); // Even malformed JSON follows schema.
            for (String key : TEXT_FIELDS) fixture.put(key, SECRET);
            for (String key : UNTOUCHED) fixture.put(key, SECRET);
            fixture.put("braintrust.error_json", "\"" + SECRET + "\"");
            for (String key : TEXT_ERROR_FIELDS) fixture.put(key, SECRET);
            root.setAllAttributes(fixture.build());
            root.setAttribute("gen_ai.usage.input_tokens", 7L);
            root.setAttribute("braintrust.metrics", "{\"prompt_tokens\":7}");
            root.setStatus(StatusCode.ERROR, SECRET);
            root.addEvent("conversation", fixture.build());
            root.recordException(new IllegalArgumentException(SECRET));
            var messageEvent = Attributes.builder().put("content", SECRET).put("message", SECRET)
                    .put("input", SECRET).put("safe.counter", 2L).build();
            for (String name : List.of("gen_ai.user.message", "gen_ai.assistant.message",
                    "gen_ai.system.message", "gen_ai.tool.message")) root.addEvent(name, messageEvent);
            root.addEvent("gen_ai.choice", messageEvent);
            root.addEvent("unrelated.event", messageEvent);
            root.addEvent("gen_ai.user.message", Attributes.builder().put("safe.counter", 3L).build());
            var child = tracer.spanBuilder("manual.child").setParent(Context.root().with(root)).startSpan();
            childId = child.getSpanContext().getSpanId();
            child.setAttribute("input", SECRET); // No output should be invented.
            child.end();
            var client = BraintrustOpenAI.wrapOpenAI(otel,
                    OpenAIOkHttpClient.builder().apiKey("local-dummy").baseUrl(base + "/v1").build());
            try (var scope = root.makeCurrent()) {
                var result = client.chat().completions().create(ChatCompletionCreateParams.builder()
                        .model("gpt-4o-mini").addUserMessage(SECRET).build());
                require(SECRET.equals(result.choices().get(0).message().content().orElseThrow()),
                        "application response is untouched");
            } finally {
                root.end();
                client.close();
            }
            require(otel.getSdkTracerProvider().forceFlush().join(20, TimeUnit.SECONDS).isSuccess(), "HTTP export");
        }
        var spans = received.stream().flatMap(r -> r.request().getResourceSpansList().stream())
                .flatMap(r -> r.getScopeSpansList().stream()).flatMap(s -> s.getSpansList().stream()).toList();
        require(spans.size() == 3, "manual root, child and instrumented provider span");
        for (var request : received) require(("project_id:" + PROJECT).equals(request.parent()), "routing header");
        for (var span : spans) {
            String id = HexFormat.of().formatHex(span.getSpanId().toByteArray());
            require(traceId.equals(HexFormat.of().formatHex(span.getTraceId().toByteArray())), "trace identity");
            String parent = HexFormat.of().formatHex(span.getParentSpanId().toByteArray());
            require((id.equals(rootId) ? "" : rootId).equals(parent), "parent identity");
            var attrs = attributes(span.getAttributesList());
            require(("project_id:" + PROJECT).equals(attrs.get("braintrust.parent").getStringValue()), "routing attribute");
            if (id.equals(rootId)) {
                checkFields(attrs, errors);
                require(attrs.get("gen_ai.usage.input_tokens").getIntValue() == 7, "usage preserved");
                require("{\"prompt_tokens\":7}".equals(attrs.get("braintrust.metrics").getStringValue()), "metrics preserved");
                require(span.getStatus().getCodeValue() == 2, "error status code preserved");
                require((errors ? "[REDACTED]" : SECRET).equals(span.getStatus().getMessage()), "status description policy");
                require(span.getEventsCount() == 9, "events retained");
                checkFields(attributes(span.getEvents(0).getAttributesList()), errors);
                var exception = attributes(span.getEvents(1).getAttributesList());
                require((errors ? "[REDACTED]" : SECRET).equals(exception.get("exception.message").getStringValue()), "exception policy");
                require((errors ? "[REDACTED]" : "java.lang.IllegalArgumentException")
                        .equals(exception.get("exception.type").getStringValue()), "exception type policy");
                require(errors ? "[REDACTED]".equals(exception.get("exception.stacktrace").getStringValue())
                        : exception.get("exception.stacktrace").getStringValue().contains(SECRET), "stacktrace policy");
                for (int i = 2; i <= 7; i++) {
                    var event = span.getEvents(i);
                    var fields = attributes(event.getAttributesList());
                    require((i <= 5 ? "[REDACTED]" : SECRET).equals(fields.get("content").getStringValue()),
                            "event-name-scoped content: " + event.getName());
                    require((i == 6 ? "\"[REDACTED]\"" : SECRET).equals(fields.get("message").getStringValue()),
                            "event-name-scoped message: " + event.getName());
                    require("[REDACTED]".equals(fields.get("input").getStringValue()), "canonical rules on every event");
                    require(fields.get("safe.counter").getIntValue() == 2, "event metric preserved");
                    require(event.getTimeUnixNano() > 0, "event timestamp preserved");
                }
                var absentContent = attributes(span.getEvents(8).getAttributesList());
                require(!absentContent.containsKey("content") && !absentContent.containsKey("message"),
                        "missing event fields not invented");
            } else if (id.equals(childId)) {
                require("[REDACTED]".equals(attrs.get("input").getStringValue()), "input-only child");
                require(!attrs.containsKey("output") && !attrs.containsKey("braintrust.output_json"), "absent output retained");
            } else {
                require("\"[REDACTED]\"".equals(attrs.get("braintrust.input_json").getStringValue()), "provider input");
                require("\"[REDACTED]\"".equals(attrs.get("braintrust.output_json").getStringValue()), "provider output");
            }
        }
    }

    public static void main(String[] args) throws Exception {
        var received = new CopyOnWriteArrayList<Received>();
        var failures = new CopyOnWriteArrayList<Throwable>();
        var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/otel/v1/traces", exchange -> {
            try (exchange) {
                byte[] bytes = exchange.getRequestBody().readAllBytes();
                if ("gzip".equalsIgnoreCase(exchange.getRequestHeaders().getFirst("Content-Encoding"))) {
                    try (var gzip = new GZIPInputStream(new ByteArrayInputStream(bytes))) { bytes = gzip.readAllBytes(); }
                }
                received.add(new Received(exchange.getRequestHeaders().getFirst("x-bt-parent"),
                        ExportTraceServiceRequest.parseFrom(bytes)));
                exchange.getResponseHeaders().set("Content-Type", "application/x-protobuf");
                exchange.sendResponseHeaders(200, -1);
            } catch (Throwable failure) { failures.add(failure); } // Test receiver, not hook error handling.
        });
        server.createContext("/v1/chat/completions", exchange -> {
            try (exchange) {
                exchange.getRequestBody().readAllBytes();
                byte[] response = ("{\"id\":\"chatcmpl-local\",\"object\":\"chat.completion\",\"created\":1,"
                        + "\"model\":\"gpt-4o-mini\",\"choices\":[{\"index\":0,\"message\":{\"role\":\"assistant\","
                        + "\"content\":\"" + SECRET + "\"},\"finish_reason\":\"stop\"}],"
                        + "\"usage\":{\"prompt_tokens\":7,\"completion_tokens\":3,\"total_tokens\":10}}")
                        .getBytes(StandardCharsets.UTF_8);
                exchange.getResponseHeaders().set("Content-Type", "application/json");
                exchange.sendResponseHeaders(200, response.length);
                exchange.getResponseBody().write(response);
            }
        });
        server.start();
        try {
            String base = "http://127.0.0.1:" + server.getAddress().getPort();
            exercise(base, received, false);
            exercise(base, received, true);
            require(failures.isEmpty(), "receiver parsed all exports");
            System.out.println("PASS Java: conversation policy, optional errors, provider instrumentation and local HTTP export");
        } finally { server.stop(0); }
    }
}
```

Run once to resolve the latest SDK, record dependency locks, compile and execute assertions:

```bash
gradle --no-daemon --console=plain --quiet run --write-locks
```

Commit `gradle.lockfile` in a real app; subsequent runs omit `--write-locks`. Update locks deliberately when upgrading. Only dependency downloads need internet; export and provider HTTP calls above use loopback addresses and dummy credentials. Success means exit code zero and the `PASS Java:` line. SDK, SLF4J or Gradle diagnostics may accompany it; do not compare the complete console output to a single expected line. Backend ingestion/readback is a separate verification step in the general workflow.
