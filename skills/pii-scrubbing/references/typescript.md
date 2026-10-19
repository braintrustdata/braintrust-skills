# TypeScript: native SDK and OpenTelemetry

These are **separate export paths**: native `braintrust` spans need a native customizer; OTel spans need the exporter wrapper. The default policy below replaces conversation input/output only. Errors, exception attributes, status, metadata, IDs, parents, routing, and metrics remain unchanged. Error text can itself contain PII; opt into the separate error-redaction add-on only if requested.

## Install and run

Use a fresh directory with current packages; retain the generated lockfile for reproducible subsequent installs:

```sh
npm init -y
npm pkg set type=module
npm install braintrust@latest @braintrust/otel@latest openai@latest @traceloop/instrumentation-openai@latest @opentelemetry/api @opentelemetry/core @opentelemetry/sdk-trace-base @opentelemetry/context-async-hooks @opentelemetry/exporter-trace-otlp-http zod
npm install --save-dev tsx
```

`@opentelemetry/exporter-trace-otlp-http` is a required peer of `@braintrust/otel`, not an alternative exporter added alongside it. Save the three blocks below as `local-receiver.ts`, `native.ts`, and `otel.ts`. Run the two paths in **separate processes**, without production instrumentation preloads:

```sh
npx tsx native.ts
npx tsx otel.ts
# Optional: explicitly enable captured-error redaction as well.
REDACT_ERRORS=1 npx tsx native.ts
REDACT_ERRORS=1 npx tsx otel.ts
```

These examples exercise real SDK HTTP exports and actual OpenAI instrumentation. Only the provider HTTP response is stubbed locally: no paid model calls, account, real credentials, or uploads to Braintrust are involved. The receiver is test scaffolding, not production plumbing. In an application, reuse its logger/provider and existing test framework, configure real credentials/endpoints, and retain the policy at the same export boundary.

## Shared local receiver

```typescript
// local-receiver.ts
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";

export const conversation = "conversation-person@example.invalid";
export const capturedError = "captured-error@example.invalid";
export async function localReceiver() {
  const requests: { path: string; body: string; parent: string | string[] | undefined }[] = [];
  let endpoint = "";
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    requests.push({ path: req.url!, body: Buffer.concat(chunks).toString("utf8"), parent: req.headers["x-bt-parent"] });
    res.setHeader("content-type", "application/json");
    if (req.url === "/api/apikey/login") {
      res.end(JSON.stringify({ org_info: [{ id: "local-org", name: "local", api_url: endpoint }] }));
    } else if (req.url === "/v1/chat/completions") {
      res.end(JSON.stringify({
        id: "chatcmpl-local", object: "chat.completion", created: 1, model: "local-model",
        choices: [{ index: 0, message: { role: "assistant", content: conversation }, finish_reason: "stop" }],
        usage: { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 },
      }));
    } else if (["/logs3", "/version", "/otel/v1/traces"].includes(req.url!)) {
      res.end("{}");
    } else {
      res.statusCode = 404;
      res.end("{}");
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  endpoint = `http://127.0.0.1:${address.port}`;
  return {
    endpoint, requests,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}
```

## Native

The customizer replaces each present `input` and `output` wholesale, including nested content, on every incremental record. It does not invent missing fields or mutate application objects. Configure it **before importing the main SDK** or enabling a native instrumentation preload; static imports are hoisted, so the main SDK import below is dynamic. Keep existing customizers in order, placing this policy after content enrichment.

`wrapOpenAI` is **native instrumentation**, including when OTel compatibility is enabled. Compatibility changes context/ID interoperability; it does not reroute the native background logger through `BraintrustExporter`. Current native customizer registration is unsupported in compatibility mode and may be refused. Do not combine this native recipe with `BRAINTRUST_OTEL_COMPAT` or `setupOtelCompat()`, and do not assume an OTel exporter wrapper protects `wrapOpenAI` traffic. For an OTel-only provider path, use the actual OTel instrumentation in the next section instead.

```typescript
// native.ts
import assert from "node:assert/strict";
import { z } from "zod";
import { configureInstrumentation } from "braintrust/instrumentation";
import type { SpanCustomizer } from "braintrust/instrumentation";
import { localReceiver, conversation, capturedError } from "./local-receiver.ts";

const REDACTED = "[REDACTED]";
const redactErrors = process.env.REDACT_ERRORS === "1"; // Explicit opt-in; default false.
const conversationCustomizer: SpanCustomizer = {
  onSpanExport(data) {
    const result = { ...data };
    for (const field of ["input", "output"]) {
      if (field in result) result[field] = REDACTED;
    }
    return result;
  },
};
// Optional captured-error policy, NOT customizer failure handling.
const errorCustomizer: SpanCustomizer = {
  onSpanExport(data) {
    return "error" in data ? { ...data, error: REDACTED } : data;
  },
};
configureInstrumentation({ spanCustomizers: [
  conversationCustomizer, ...(redactErrors ? [errorCustomizer] : []),
] });

const receiver = await localReceiver();
process.env.BRAINTRUST_API_URL = receiver.endpoint;
process.env.BRAINTRUST_APP_URL = receiver.endpoint;
process.env.BRAINTRUST_PROXY_URL = receiver.endpoint;
try {
  const { initLogger, wrapOpenAI } = await import("braintrust");
  const { default: OpenAI } = await import("openai");
  const logger = initLogger({
    projectName: "local-pii-test", projectId: "local-project",
    appUrl: receiver.endpoint, apiKey: "local-dummy", orgName: "local",
  });
  const client = wrapOpenAI(new OpenAI({ apiKey: "local-dummy", baseURL: `${receiver.endpoint}/v1` }));
  const input = { messages: [{ role: "user" as const, content: conversation }] };
  let rootId = "";
  await logger.traced(async (root) => {
    rootId = root.id;
    root.log({ input, metadata: { safe: "retained" } });
    await logger.flush(); // Check an input-only incremental export too.
    const response = await client.chat.completions.create({ model: "local-model", messages: input.messages });
    assert.equal(response.choices[0].message.content, conversation);
    root.log({ output: response.choices, error: capturedError });
  }, { name: "safe.root", type: "task" });
  await logger.flush();

  const captures = receiver.requests.filter((request) => request.path === "/logs3");
  const rowSchema = z.object({
    id: z.string(), span_id: z.string(), root_span_id: z.string(), project_id: z.string(),
    span_parents: z.array(z.string()).optional(),
    input: z.unknown().optional(), output: z.unknown().optional(), error: z.unknown().optional(),
    metadata: z.object({ safe: z.string().optional() }).optional(),
    metrics: z.object({ prompt_tokens: z.number().optional(), completion_tokens: z.number().optional() }).optional(),
  });
  const envelope = z.object({ rows: z.array(rowSchema) });
  const rows = captures.flatMap(({ body }) => envelope.parse(JSON.parse(body)).rows);
  assert(captures.length >= 2);
  const roots = rows.filter((row) => row.id === rootId);
  assert(roots.some((row) => row.input === REDACTED && !("output" in row)));
  assert(roots.some((row) => row.output === REDACTED));
  assert(roots.some((row) => row.error === (redactErrors ? REDACTED : capturedError)));
  assert(roots.some((row) => row.metadata?.safe === "retained"));
  const child = rows.find((row) => row.id !== rootId && row.input === REDACTED);
  assert(child, "actual wrapOpenAI child must export");
  const childRows = rows.filter((row) => row.id === child.id);
  assert(childRows.some((row) => row.output === REDACTED));
  assert(childRows.some((row) => row.span_parents?.includes(roots[0].span_id)));
  assert(childRows.every((row) => row.root_span_id === roots[0].root_span_id));
  assert(childRows.some((row) => row.metrics?.prompt_tokens === 7 && row.metrics?.completion_tokens === 3));
  for (const row of rows) {
    for (const field of ["input", "output"]) if (field in row) assert.equal(row[field], REDACTED);
    assert.equal(row.project_id, "local-project");
    assert(row.id && row.span_id && row.root_span_id);
  }
  assert(!JSON.stringify(captures).includes(conversation));
  assert.equal(input.messages[0].content, conversation);
  assert.equal(receiver.requests.filter((request) => request.path === "/v1/chat/completions").length, 1);
  console.log(`PASS native: incremental records, automatic child, conversation redaction; redactErrors=${redactErrors}`);
} finally {
  await receiver.close();
}
```

**Failure behavior:** keep the hook synchronous and return a plain object. Exceptions, promise returns, and invalid returns stop the customizer chain. The SDK's newer failure policy exports a stripped record containing original identity/routing/protocol fields, existing `metrics.start`/`metrics.end`, and `context: { customizer_error: true }`; it removes other content and emits a generic diagnostic without exception details. Packages predating that change drop the affected record instead. Do not assume an upstream change is already in the installed package: verify its behavior with a deliberate failing hook and a local receiver. Either behavior loses content from that incremental record and cannot retract earlier exports. The example adds no catch/fallback around the hook.

**Boundary:** metadata, tags, names, `expected`, and other record fields remain unchanged. This is not a generic PII detector. Provider requests/responses and application objects are intentionally unchanged. Dataset writes, feedback, application logs, previously exported data, and independently uploaded attachments are outside this policy. Replacing a field before native attachment processing removes attachment references in that field from that automatic path; do not infer coverage of other upload paths.

## OpenTelemetry

Use `OpenAIInstrumentation` from `@traceloop/instrumentation-openai`, not `wrapOpenAI`. The explicit `manuallyInstrument(OpenAI)` API patches the loaded ESM SDK; it does not rely on a loader's supported-version range. Register the provider **and** `AsyncLocalStorageContextManager`: `BasicTracerProvider` alone does not install async context propagation. `startActiveSpan` then keeps the instrumentation-created child under the application root across `await`.

Place the wrapper immediately before the real `BraintrustExporter` on **every** Braintrust OTel export path. A second unwrapped exporter or `BraintrustSpanProcessor` would export another copy. The example uses `filterAISpans: false` to retain ordinary application spans too.

The same conversation policy applies to span attributes and event attributes:

- JSON-encoded marker (`'"[REDACTED]"'`): exact `braintrust.input_json`, `braintrust.output_json`, `gen_ai.input.messages`, `gen_ai.output.messages`, `gen_ai.system_instructions`, `llm.input_messages`, `llm.output_messages`.
- Plain marker (`'[REDACTED]'`): exact `input`, `output`, `braintrust.input`, `braintrust.output`, `gen_ai.prompt`, `gen_ai.completion`, `llm.prompts`, `llm.completions`; also every dotted descendant of `gen_ai.input.messages`, `gen_ai.output.messages`, `gen_ai.system_instructions`, `gen_ai.prompt`, `gen_ai.completion`, `llm.input_messages`, `llm.output_messages`, `llm.prompts`, `llm.completions`.
- Named events `gen_ai.user.message`, `gen_ai.assistant.message`, `gen_ai.system.message`, and `gen_ai.tool.message`: replace present `content` with the plain marker. For `gen_ai.choice`, replace present `message` with the JSON-encoded marker. Apply the canonical attribute rules to every event as well; unrelated event `content`/`message` remains unchanged.

Encoding follows the attribute schema, **not whether the incoming string happens to parse as JSON**. Braintrust ingestion uses unsuffixed `braintrust.input`/`output` as raw values and JSON-parses their `_json` counterparts. Current OpenAI chat instrumentation emits JSON-encoded `gen_ai.input.messages` and `gen_ai.output.messages`. Named GenAI events need their own content rule because ingestion processes events as separate log rows. Other instrumentation can introduce additional aliases; inventory those before claiming coverage.

```typescript
// otel.ts
import assert from "node:assert/strict";
import { z } from "zod";
import { context, trace, SpanStatusCode } from "@opentelemetry/api";
import type { Attributes } from "@opentelemetry/api";
import type { ExportResult } from "@opentelemetry/core";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { BasicTracerProvider, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import type { ReadableSpan, SpanExporter } from "@opentelemetry/sdk-trace-base";
import { BraintrustExporter } from "@braintrust/otel";
import { OpenAIInstrumentation } from "@traceloop/instrumentation-openai";
import OpenAI from "openai";
import { localReceiver, conversation, capturedError } from "./local-receiver.ts";

const REDACTED = "[REDACTED]";
const redactErrors = process.env.REDACT_ERRORS === "1"; // Explicit opt-in; default false.
const jsonKeys = new Set([
  "braintrust.input_json", "braintrust.output_json",
  "gen_ai.input.messages", "gen_ai.output.messages", "gen_ai.system_instructions",
  "llm.input_messages", "llm.output_messages",
]);
const plainKeys = new Set(["input", "output", "braintrust.input", "braintrust.output", "gen_ai.prompt", "gen_ai.completion", "llm.prompts", "llm.completions"]);
const prefixes = [
  "gen_ai.input.messages.", "gen_ai.output.messages.", "gen_ai.system_instructions.",
  "gen_ai.prompt.", "gen_ai.completion.", "llm.input_messages.", "llm.output_messages.",
  "llm.prompts.", "llm.completions.",
];
const messageEvents = new Set([
  "gen_ai.user.message", "gen_ai.assistant.message", "gen_ai.system.message", "gen_ai.tool.message",
]);
function scrubAttributes(attributes: Attributes, includeErrors = false): Attributes {
  const result = { ...attributes };
  for (const key of Object.keys(result)) {
    if (jsonKeys.has(key)) result[key] = JSON.stringify(REDACTED);
    else if (plainKeys.has(key) || prefixes.some((prefix) => key.startsWith(prefix))) result[key] = REDACTED;
    // Optional captured-error add-on; no handling of transformation failures.
    else if (includeErrors) {
      if (key === "braintrust.error_json") result[key] = JSON.stringify(REDACTED);
      else if (["error", "braintrust.error"].includes(key) || key.startsWith("exception.") || key.startsWith("error.")) result[key] = REDACTED;
    }
  }
  return result;
}
function scrubSpan(span: ReadableSpan, includeErrors = false): ReadableSpan {
  const attributes = scrubAttributes(span.attributes, includeErrors);
  const events = span.events.map((event) => {
    const attributes = scrubAttributes(event.attributes ?? {}, includeErrors);
    if (messageEvents.has(event.name) && "content" in attributes) attributes.content = REDACTED;
    if (event.name === "gen_ai.choice" && "message" in attributes) attributes.message = JSON.stringify(REDACTED);
    return { ...event, attributes };
  });
  const status = includeErrors && span.status.message !== undefined
    ? { ...span.status, message: REDACTED } : span.status;
  // Preserve prototype getters/methods and their receiver; never {...span}.
  return new Proxy(span, {
    get(target, property) {
      if (property === "attributes") return attributes;
      if (property === "events") return events;
      if (property === "status") return status;
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
class ScrubbingExporter implements SpanExporter {
  constructor(private readonly delegate: SpanExporter, private readonly includeErrors = false) {}
  export(spans: ReadableSpan[], callback: (result: ExportResult) => void): void {
    this.delegate.export(spans.map((span) => scrubSpan(span, this.includeErrors)), callback);
  }
  forceFlush(): Promise<void> { return this.delegate.forceFlush?.() ?? Promise.resolve(); }
  shutdown(): Promise<void> { return this.delegate.shutdown(); }
}

const receiver = await localReceiver();
const provider = new BasicTracerProvider({ spanProcessors: [
  new SimpleSpanProcessor(new ScrubbingExporter(new BraintrustExporter({
    apiKey: "local-dummy", apiUrl: receiver.endpoint,
    parent: "project_id:local-project", filterAISpans: false,
  }), redactErrors)),
] });
const contextManager = new AsyncLocalStorageContextManager().enable();
context.setGlobalContextManager(contextManager);
trace.setGlobalTracerProvider(provider);
const instrumentation = new OpenAIInstrumentation({ enabled: false, traceContent: true });
instrumentation.setTracerProvider(provider);
instrumentation.manuallyInstrument(OpenAI);
try {
  const tracer = provider.getTracer("local-pii-test");
  const client = new OpenAI({ apiKey: "local-dummy", baseURL: `${receiver.endpoint}/v1` });
  let rootSpanId = "";
  let rootTraceId = "";
  await tracer.startActiveSpan("safe.root", async (root) => {
    rootSpanId = root.spanContext().spanId;
    rootTraceId = root.spanContext().traceId;
    root.setAttributes({
      "braintrust.input_json": JSON.stringify({ question: conversation }),
      "metadata.safe": "retained", "gen_ai.usage.input_tokens": 11,
      "braintrust.input": conversation, "braintrust.output": conversation,
    });
    await Promise.resolve(); // Parenting must survive an async boundary.
    const response = await client.chat.completions.create({
      model: "local-model", messages: [{ role: "user", content: conversation }],
    });
    assert.equal(response.choices[0].message.content, conversation);
    root.setAttribute("braintrust.output_json", JSON.stringify(response.choices));
    root.addEvent("safe.event", { "llm.prompts.0.content": conversation, "metadata.safe": "retained", content: "retained", message: "retained" });
    for (const name of ["gen_ai.user.message", "gen_ai.assistant.message", "gen_ai.system.message", "gen_ai.tool.message"]) {
      root.addEvent(name, { content: conversation, "braintrust.input": conversation });
    }
    root.addEvent("gen_ai.choice", { message: JSON.stringify({ role: "assistant", content: conversation }) });
    root.recordException(new Error(capturedError));
    root.setStatus({ code: SpanStatusCode.ERROR, message: capturedError });
    root.end();
  });
  await provider.forceFlush();

  const captures = receiver.requests.filter((request) => request.path === "/otel/v1/traces");
  const wireAttributes = z.array(z.object({ key: z.string(), value: z.object({
    stringValue: z.string().optional(), intValue: z.union([z.string(), z.number()]).optional(),
    doubleValue: z.number().optional(),
  }) }));
  const wireSpan = z.object({
    spanId: z.string(), traceId: z.string(), parentSpanId: z.string().optional(),
    startTimeUnixNano: z.string(), endTimeUnixNano: z.string(),
    attributes: wireAttributes,
    events: z.array(z.object({ name: z.string(), attributes: wireAttributes.optional() })).default([]),
    status: z.object({ code: z.number().optional(), message: z.string().optional() }),
  });
  const envelope = z.object({ resourceSpans: z.array(z.object({
    scopeSpans: z.array(z.object({ spans: z.array(wireSpan) })),
  })) });
  const spans = captures.flatMap(({ body }) => envelope.parse(JSON.parse(body)).resourceSpans)
    .flatMap((resource) => resource.scopeSpans).flatMap((scope) => scope.spans);
  const attrs = (items: z.infer<typeof wireAttributes> = []) => Object.fromEntries(items.map(({ key, value }) =>
    [key, value.stringValue ?? Number(value.intValue ?? value.doubleValue)]));
  assert.equal(spans.length, 2);
  const root = spans.find((span) => span.spanId === rootSpanId);
  const child = spans.find((span) => span.spanId !== rootSpanId);
  assert(root && child, "actual OTel-instrumented OpenAI child must export");
  assert.equal(child.parentSpanId, rootSpanId);
  assert.equal(child.traceId, rootTraceId);
  assert.equal(attrs(root.attributes)["braintrust.input_json"], JSON.stringify(REDACTED));
  assert.equal(attrs(root.attributes)["braintrust.output_json"], JSON.stringify(REDACTED));
  assert.equal(attrs(root.attributes)["braintrust.input"], REDACTED);
  assert.equal(attrs(root.attributes)["braintrust.output"], REDACTED);
  assert.equal(attrs(root.attributes)["metadata.safe"], "retained");
  assert.equal(attrs(child.attributes)["gen_ai.input.messages"], JSON.stringify(REDACTED));
  assert.equal(attrs(child.attributes)["gen_ai.output.messages"], JSON.stringify(REDACTED));
  assert.equal(attrs(child.attributes)["gen_ai.usage.input_tokens"], 7);
  assert.equal(attrs(child.attributes)["gen_ai.usage.output_tokens"], 3);
  assert.equal(attrs(root.events.find((event) => event.name === "safe.event")?.attributes)["llm.prompts.0.content"], REDACTED);
  const safeEvent = attrs(root.events.find((event) => event.name === "safe.event")?.attributes);
  assert.equal(safeEvent.content, "retained");
  assert.equal(safeEvent.message, "retained");
  for (const name of ["gen_ai.user.message", "gen_ai.assistant.message", "gen_ai.system.message", "gen_ai.tool.message"]) {
    const event = attrs(root.events.find((event) => event.name === name)?.attributes);
    assert.equal(event.content, REDACTED);
    assert.equal(event["braintrust.input"], REDACTED);
  }
  assert.equal(attrs(root.events.find((event) => event.name === "gen_ai.choice")?.attributes).message, JSON.stringify(REDACTED));
  const exception = attrs(root.events.find((event) => event.name === "exception")?.attributes);
  assert.equal(exception["exception.message"], redactErrors ? REDACTED : capturedError);
  assert.equal(exception["exception.type"], redactErrors ? REDACTED : "Error");
  assert.equal(root.status.code, SpanStatusCode.ERROR);
  assert.equal(root.status.message, redactErrors ? REDACTED : capturedError);
  assert(spans.every((span) => span.startTimeUnixNano && span.endTimeUnixNano));
  assert(captures.every((capture) => capture.parent === "project_id:local-project"));
  assert(!JSON.stringify(captures).includes(conversation));
  assert.equal(receiver.requests.filter((request) => request.path === "/v1/chat/completions").length, 1);
  console.log(`PASS OTel: automatic child/async parenting, HTTP export, conversation redaction; redactErrors=${redactErrors}`);
} finally {
  await provider.shutdown();
  context.disable();
  trace.disable();
  await receiver.close();
}
```

The proxy preserves identity, parenting, routing, timing, and prototype-backed methods without mutating the original span. The wrapper adds no custom error handling: transformation failures propagate to the OTel processor, whose behavior is SDK-dependent. Optional error redaction changes **captured telemetry**, not hook-failure behavior. Its explicit scope is `error`, `braintrust.error`, `braintrust.error_json`, `exception.*`, `error.*`, and status messages; status codes remain unchanged.

**Backend mapping:** OTLP attributes and Braintrust row columns are not interchangeable. An exported `gen_ai.*` conversation attribute can appear under backend metadata while top-level `input`/`output` remain null, depending on ingestion configuration. A JSON scalar redaction marker is not a message array, so an ingestion path expecting messages may leave those columns null. Ingestion also creates separate log rows from events, making the named-event policy necessary even when the parent span is already scrubbed. Inspect both the real outbound envelope and supported backend readback; a null row column is not evidence that the exporter omitted the attribute. Do not synthesize `braintrust.input_json`/`output_json` on automatic child spans merely to make the UI match a native trace. The root above has its own explicit application input/output; its child retains the provider instrumentation's schema.

**Boundary:** names (including event names), resource/scope attributes, links, metadata, and other span/event attributes are unchanged. Tool definitions, additional aliases such as `ai.*`, OTel logs/metrics, other exporters, and attachments uploaded before export need their own explicitly requested policies. This is conversation redaction, not an all-attribute PII sanitizer.

## Application verification

Use the application's existing unit-test framework to check independent positive/negative fixtures: exact JSON keys, plain keys, dotted descendants, lookalike keys that must remain unchanged, and both span/event attributes. Include malformed incoming JSON to confirm encoding is schema-based; check that missing input/output are not invented. Verify default errors/status are preserved, opt-in error redaction works, original application data is unchanged, and automatic child spans retain parents/metrics/routing. The local examples assert transport behavior; they do not test server ingestion mapping or every provider API/streaming mode.

## Sources

- [Braintrust SDK repository](https://github.com/braintrustdata/braintrust-sdk-javascript)
- [Native SDK package](https://www.npmjs.com/package/braintrust)
- [Braintrust OTel package](https://www.npmjs.com/package/@braintrust/otel)
- [OpenAI OTel instrumentation package](https://www.npmjs.com/package/@traceloop/instrumentation-openai)
- [OpenTelemetry JavaScript repository](https://github.com/open-telemetry/opentelemetry-js)
