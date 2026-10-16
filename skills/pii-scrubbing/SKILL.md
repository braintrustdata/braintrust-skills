---
name: pii-scrubbing
description: "Wire up Braintrust span customizers to traverse span fields, then apply the requested scrubbing logic or ask what to scrub if unspecified. Includes LLM chat-message redaction examples and Python/TypeScript native and OpenTelemetry, Java, Go, and Ruby integrations."
---

# Scrub PII with Braintrust span customizers

## Workflow

### 1. Wire up the plumbing to traverse span fields

Recommend the latest Braintrust SDK for the application's language. Inspect its instrumentation bootstrap and export path, then connect a span customizer to the existing logger or tracer provider; do not create a second telemetry pipeline. See the language references below for concrete customizer and registration examples.

Check for existing scrubbing first, including Python's `braintrust.set_masking_function` and TypeScript's `setMaskingFunction`. These native SDK hooks receive individual field values, not complete spans; they cover fields such as input/output and metadata, but not every record field or OTel export path. Reuse an approved existing policy where it covers the request rather than installing a second scrubber. Add a span customizer only for the required coverage, preserving existing masking configuration. Verify the installed SDK's ordering and attachment behavior; a masking hook alone is not proof that attachments or parallel exporters are protected.

Expose the fields needed by the requested policy inside the hook:

- For whole-field conversation replacement, enumerate the relevant fields/attributes and replace their values. A recursive walk of the messages is unnecessary.
- For selective key/value matching, traverse the relevant nested objects and arrays and retain field paths. Inventory other locations where that content may be copied; do not assume input/output are the only sensitive fields.
- For OpenTelemetry, use the public export representation rather than enumerating a live span's own properties. Include event attributes when the policy covers conversation content; resources, scope, links, status, and metadata need explicit coverage only when requested.
- Treat SDK attachment objects and other non-JSON objects as opaque values unless a supported adapter is available. Do not walk private SDK internals or stringify the whole span.
- Keep identity, parent relationships, routing, and protocol fields unchanged. Do not mutate application-owned objects or log inspected values; keys and paths can also contain secrets.
- Keep the hook synchronous and local. Preserve existing customizers and place scrubbing after content-enriching hooks.

**Do not add error handling unless the user explicitly asks for it.** The SDK provides error handling for span customizers. Do not introduce custom try/catch blocks, retries, fallback records, or failure policies around the scrubber. Use the installed SDK's behavior.

#### Language references

The language examples use a **conversation-only preset**: errors, exception details, and status descriptions remain unchanged. Each guide provides an explicit optional captured-error add-on. Reuse the registration independently of the preset and enable only the requested policy. Redacting captured error content is separate from adding error handling around the hook.

| Language / export path     | Customizer example                                        | Integration point                                                 |
|----------------------------|-----------------------------------------------------------|-------------------------------------------------------------------|
| Python — native            | [Python native](references/python.md#native)              | `braintrust.set_span_customizers` before logging                  |
| Python — OpenTelemetry     | [Python OTel](references/python.md#opentelemetry)         | `set_span_customizers` over the SDK's OTel snapshot dictionaries |
| TypeScript — native        | [TypeScript native](references/typescript.md#native)      | `configureInstrumentation` before importing the main SDK          |
| TypeScript — OpenTelemetry | [TypeScript OTel](references/typescript.md#opentelemetry) | Wrapper around the real OTel exporter                             |
| Java                       | [Java](references/java.md)                                | Braintrust customizer over OTel `SpanData`                        |
| Go                         | [Go](references/go.md)                                    | Braintrust customizer over OTel `ReadOnlySpan`                    |
| Ruby                       | [Ruby](references/ruby.md)                                | `span_customizers:` / `on_span_export` on the Braintrust exporter |

Match the actual export path: native top-level field redaction does not scrub OTel attributes. TypeScript `wrapOpenAI` emits native Braintrust spans even when OTel compatibility is enabled; enabling compatibility is not an exporter migration. Use real OTel provider instrumentation for the OTel path. The language references show the provider wrapper/instrumentor, bootstrap ordering, context propagation, and flush/shutdown calls.

### 2. Apply the requested scrubbing logic

If the prompt specifies what to scrub, implement it directly in the connected hook. Reuse an existing approved local scrubber where applicable. **Ask only when the requested policy is missing or ambiguous**, for example:

> What should this hook scrub: entire LLM conversations, credentials such as API keys or bearer tokens, personal data such as emails, or particular fields? Should matching values be replaced with `"[REDACTED]"` or should non-sensitive message content be retained?

Ask for categories, field paths, or synthetic examples—not real secrets. Do not re-ask questions the prompt already answers or silently broaden the policy. Wiring a pass-through hook is not redaction; do not send sensitive traffic through an unconfigured policy and claim it is protected.

#### Example: scrub LLM chat messages

When the user asks to remove entire chat-message payloads, replace the relevant input/output values with `"[REDACTED]"`:

Use this shared conversation policy in each language. Apply the OTel attribute rules to both span attributes and event attributes; absent fields stay absent.

| Representation / keys | Replacement |
| --- | --- |
| Native records: `input`, `output` | Plain `[REDACTED]` |
| OTel JSON fields: `braintrust.input_json`, `braintrust.output_json`, `gen_ai.input.messages`, `gen_ai.output.messages`, `gen_ai.system_instructions`, `llm.input_messages`, `llm.output_messages` | JSON string literal `"[REDACTED]"`, including the quotes |
| OTel plain fields: `input`, `output`, `braintrust.input`, `braintrust.output`, `gen_ai.prompt`, `gen_ai.completion`, `llm.prompts`, `llm.completions` | Plain `[REDACTED]` |
| OTel keys starting with `gen_ai.input.messages.`, `gen_ai.output.messages.`, `gen_ai.system_instructions.`, `gen_ai.prompt.`, `gen_ai.completion.`, `llm.input_messages.`, `llm.output_messages.`, `llm.prompts.`, `llm.completions.` | Plain `[REDACTED]` |
| Events named `gen_ai.user.message`, `gen_ai.assistant.message`, `gen_ai.system.message`, or `gen_ai.tool.message`: their `content` attribute | Plain `[REDACTED]` |
| Events named `gen_ai.choice`: their `message` attribute | JSON string literal `"[REDACTED]"`, including the quotes |

Choose JSON encoding by the attribute's schema, not by whether the original value happens to parse as JSON. The unsuffixed `braintrust.input`/`braintrust.output` aliases are raw values, unlike their `_json` variants. Do not replace `content` or `message` on unrelated event types. Keep token counts and other unrelated telemetry unchanged. Other instrumentation conventions require explicit additions to the policy and tests.

Whole-field replacement removes nested messages and tool arguments/results without inspecting their contents. Apply it to each outgoing record, including input-only and output-only updates. Do not rely on an LLM-type predicate when classification may be absent from incremental records or messages may be copied into tool/task spans.

This example does not automatically scrub errors, metadata, names, context, resources, links, or attachments elsewhere. Add those only as required by the requested policy. Traversal access is not the same as redaction coverage.

If captured-error scrubbing is requested, use plain `[REDACTED]` for native `error`, OTel `error`, `braintrust.error`, and `error.*`/`exception.*` attributes; only `braintrust.error_json` uses the JSON-encoded marker. The optional language examples also cover exception-event attributes and status descriptions.

### 3. Add unit tests for the scrubber, where applicable

Use the application's existing testing framework and conventions to add focused unit tests for the specific scrubbing policy. Prefer available tooling over introducing a new framework solely for this task.

Use synthetic secrets and assert actual transformed values with independent positive and negative fixtures. Cover relevant cases:

- Covered conversation fields and aliases are redacted on spans and events; unrelated fields are preserved.
- Errors, exceptions, and status remain unchanged by default; test their removal separately if the optional error policy is enabled.
- Named GenAI event content is scrubbed without changing unrelated event content.
- Nested values, absent fields, null values, and input-only/output-only records are handled as intended.
- JSON-valued attributes remain valid JSON, and plain attributes contain the plain marker.
- Identity, routing, and application-owned inputs remain unchanged; repeat application is stable.

Keep the policy's key list centralized within the implementation, but do not derive every expected test value from that same list—a missing key would make both implementation and test wrong.

Test the application's policy, not SDK internals, and do not add custom error handling just to support tests. Run the relevant tests and report the command and result. If unit tests are not applicable or no suitable tooling is available, state that limitation and perform the synthetic export check below. Unit tests complement, rather than replace, verification of the actual export path.

## Verify and report

Use synthetic data to exercise the real provider instrumentation and export path, flush it, and inspect the exported payload. A manually created task span alone does not prove an LLM wrapper or OTel instrumentor is connected. Local provider responses and local export receivers are sufficient for a credential-free smoke check.

- Confirm selected secrets are removed and unrelated content, IDs, parents, routing, and safe metrics are preserved.
- Exercise incremental updates where applicable and confirm application inputs/provider responses remain unchanged.
- Verify parentage through the real async context path; a manual explicit parent does not prove automatic context propagation.

### Check stored spans when a test project is available

Use the supported CLI, with a profile and org matching the SDK's credentials and endpoint. Check `bt status` and `bt sql --help` first. An org-not-found error can indicate an API-key/profile org mismatch; pass `--org` explicitly. If multiple profiles match, pass `--profile` too. Do not change saved profiles just to make the test work.

```bash
bt sql --profile "<profile>" --org "<org>" --project "<project>" --json --non-interactive \
  "SELECT * FROM logs WHERE root_span_id = '<root-span-id>' LIMIT 1000"
```

`FROM logs` is the CLI's shorthand when `--project` is supplied. For direct OTel ingestion, the hex OTel **trace ID** maps to `root_span_id`; do not substitute the root span's span ID. Native SDK IDs can use a different representation, so capture the actual exported/root ID. Scope queries to that run; if the result hits the limit, use the CLI's supported pagination rather than treating a truncated result as complete.

Inspect all returned rows, not just `input` and `output`:

- OTel attributes that are not removed during ingestion can remain in metadata, including `gen_ai.*` content. A JSON-encoded scalar redaction marker is valid JSON but is not a GenAI message array, so the UI's input/output can be null while the scrubbed marker is in metadata. That alone is neither a leak nor proof of protection.
- OTel span events become separate rows with `span_attributes.type = "log"`; their attributes can be in metadata and their name in output. Include those rows in the scan. Event names, arbitrary attributes, and error content remain outside a conversation-only policy unless explicitly covered.
- Search every location where the synthetic secret was placed, and check span/parent IDs and numeric token/cost metrics where supplied. Do not invent input/output attributes merely to make a UI redaction assertion pass.

If a permission boundary blocks the CLI or readback, report that limitation or request access. Do not bypass it with private SDK `_state` calls. Local exports prove client-side scrubbing, not server-side mapping or ingestion.

Report the connected export path, applied policy, verification commands/results, and exclusions. Distinguish unit tests, local provider/export smoke checks, and server readback; do not claim one proves the others.
