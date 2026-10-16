# Ruby: Braintrust exporter customizer

This standalone example replaces whole conversation fields at export; it preserves captured errors, status, metadata, and other fields by default. The optional captured-error policy below requires explicit opt-in and is not hook-failure handling.

## Install

Use the latest compatible [Braintrust Ruby SDK](https://github.com/braintrustdata/braintrust-sdk-ruby), [OpenTelemetry SDK](https://rubygems.org/gems/opentelemetry-sdk), and official [OpenAI gem](https://rubygems.org/gems/openai). The `:openai` integration below is for the official `openai` package, not the separate `ruby-openai` package. Select an application-compatible Ruby with your runtime manager.

Save as `Gemfile`:

```ruby
source "https://rubygems.org"

gem "braintrust"
gem "openai"
gem "opentelemetry-sdk"
gem "opentelemetry-exporter-otlp"
gem "minitest" # Local verification only.
gem "webrick"  # Local verification only.
```

```bash
bundle install
# In an existing application, update these dependencies to compatible current releases:
bundle update braintrust openai opentelemetry-sdk opentelemetry-exporter-otlp
```

Keep the generated lockfile. No source build of Braintrust is required.

## Conversation-only policy

Save as `pii_customizer.rb`:

```ruby
# frozen_string_literal: true

require "braintrust"
require "json"

class PiiCustomizer
  REDACTED = "[REDACTED]"
  JSON_REDACTED = JSON.generate(REDACTED).freeze
  JSON_KEYS = %w[
    braintrust.input_json braintrust.output_json
    gen_ai.input.messages gen_ai.output.messages gen_ai.system_instructions
    llm.input_messages llm.output_messages
  ].freeze
  TEXT_KEYS = %w[
    braintrust.input braintrust.output
    input output gen_ai.prompt gen_ai.completion llm.prompts llm.completions
  ].freeze
  TEXT_PREFIXES = %w[
    gen_ai.input.messages. gen_ai.output.messages. gen_ai.system_instructions.
    gen_ai.prompt. gen_ai.completion. llm.input_messages. llm.output_messages.
    llm.prompts. llm.completions.
  ].freeze
  MESSAGE_EVENTS = %w[
    gen_ai.user.message gen_ai.assistant.message gen_ai.system.message gen_ai.tool.message
  ].freeze

  def scrub_value(key, value)
    if JSON_KEYS.include?(key)
      JSON_REDACTED
    elsif TEXT_KEYS.include?(key) || TEXT_PREFIXES.any? { |prefix| key.start_with?(prefix) }
      REDACTED
    else
      value
    end
  end

  def scrub_attributes(attributes)
    scrubbed = attributes
    attributes&.each do |key, value|
      replacement = scrub_value(key, value)
      next if replacement == value

      scrubbed = attributes.dup if scrubbed.equal?(attributes)
      scrubbed[key] = replacement
    end
    scrubbed
  end

  def scrub_event_attributes(event)
    attributes = scrub_attributes(event.attributes)
    return attributes unless attributes

    if MESSAGE_EVENTS.include?(event.name)
      key, replacement = "content", REDACTED
    elsif event.name == "gen_ai.choice"
      key, replacement = "message", JSON_REDACTED
    else
      return attributes
    end
    if attributes.key?(key) && attributes[key] != replacement
      attributes = attributes.dup if attributes.equal?(event.attributes)
      attributes[key] = replacement
    end
    attributes
  end

  def on_span_export(span)
    attributes = scrub_attributes(span.attributes)
    events = span.events
    span.events&.each_with_index do |event, index|
      event_attributes = scrub_event_attributes(event)
      next if event_attributes.equal?(event.attributes)

      events = span.events.dup if events.equal?(span.events)
      events[index] = OpenTelemetry::SDK::Trace::Event.new(
        event.name, event_attributes, event.timestamp
      )
    end
    return span if attributes.equal?(span.attributes) && events.equal?(span.events)

    replacement = span.to_span_data.dup
    replacement.attributes = attributes
    replacement.events = events
    replacement
  end
end
```

Ruby uses OTel internally. `span_customizers:` receives a writable `Braintrust::Trace::SpanExportData` at the Braintrust OTLP export boundary, after origin enrichment and before destination grouping/serialization. Trace, span, and parent IDs are read-only. The hook returns the original view when unchanged; otherwise it returns a shallow `SpanData` replacement, copying only changed attribute maps, the event array when an event changes, and changed event objects. It never mutates the supplied span or its shared nested values. Unchanged objects and nil attributes/events stay unchanged. This copy-on-write guarantee applies to this hook: the SDK itself prepares a writable attribute map before invoking customizers.

The exact keys in `JSON_KEYS` receive the JSON string literal `"[REDACTED]"`; exact `TEXT_KEYS` and dotted descendants of `TEXT_PREFIXES` receive plain `[REDACTED]`. Classification follows the attribute schema, not whether a value happens to parse as JSON. The same rules apply to span and event attributes. Missing fields stay missing.

Unsuffixed `braintrust.input`/`braintrust.output` use the plain marker; only their `_json` counterparts are JSON-decoded during ingestion. Named `gen_ai.user.message`, `gen_ai.assistant.message`, `gen_ai.system.message`, and `gen_ai.tool.message` events also redact an existing `content` attribute as plain text. Named `gen_ai.choice` events redact an existing `message` attribute as JSON. Canonical attribute rules still apply to every event; unrelated event `content`/`message` fields remain unchanged. Event ingestion can create separate log rows, so span-only or prefix-only scrubbing is insufficient.

Depending on ingestion configuration, `gen_ai.*` attributes may remain metadata. A JSON scalar marker is not a message array, so a server's derived input/output can be null. Do not invent input/output fields to mask this distinction.

Errors/exception attributes, status code and description, metadata, expected values, names, event names/timestamps, metrics, routing, links, resources, and instrumentation scope are unchanged. Other exporters, application logs, and attachment uploads are not protected by this hook. This is not a guarantee of PII-free spans; inspect the actual fields captured by your instrumentation.

### Optional: also redact captured errors

Only if the requested policy includes captured errors, save as `error_customizer.rb`:

```ruby
# frozen_string_literal: true

require_relative "pii_customizer"

class ConversationAndErrorCustomizer < PiiCustomizer
  def scrub_value(key, value)
    if key == "braintrust.error_json"
      JSON_REDACTED
    elsif key == "error" || key == "braintrust.error" || key.start_with?("exception.", "error.")
      REDACTED
    else
      super
    end
  end

  def on_span_export(span)
    result = super
    status = result.status
    if status && !status.description.to_s.empty? && status.description != REDACTED
      result = span.to_span_data.dup if result.equal?(span)
      result.status = case status.code
      when OpenTelemetry::Trace::Status::ERROR then OpenTelemetry::Trace::Status.error(REDACTED)
      when OpenTelemetry::Trace::Status::OK then OpenTelemetry::Trace::Status.ok(REDACTED)
      else OpenTelemetry::Trace::Status.unset(REDACTED)
      end
    end
    result
  end
end
```

This adds `braintrust.error_json` as JSON, plain `error`/`braintrust.error`, every `exception.*`/`error.*` span or event attribute (including exception types), and nonempty status descriptions. Status codes stay unchanged. Register **only** `ConversationAndErrorCustomizer.new` instead of `PiiCustomizer.new` to opt in. It does not rescue failures in the customizer or application.

## Bootstrap and provider instrumentation

Save as `app.rb`, or integrate into your existing bootstrap (do not initialize Braintrust a second time):

```ruby
# frozen_string_literal: true

require "openai" # Load the supported provider before enabling its instrumentation.
require_relative "pii_customizer"

Braintrust.init(
  api_key: ENV.fetch("BRAINTRUST_API_KEY"),
  default_project: ENV.fetch("BRAINTRUST_PROJECT"),
  filter_ai_spans: false,
  span_customizers: [PiiCustomizer.new],
  auto_instrument: {only: [:openai]}
)

provider = OpenTelemetry.tracer_provider
client = OpenAI::Client.new(api_key: ENV.fetch("OPENAI_API_KEY"))
tracer = provider.tracer("support-app")
begin
  tracer.in_span("support.root") do |span|
    messages = [{role: "user", content: "synthetic-person@example.invalid needs help"}]
    span.set_attribute("braintrust.input_json", JSON.generate(messages))
    response = client.chat.completions.create(
      model: ENV.fetch("OPENAI_MODEL"), messages: messages
    )
    answer = response.choices.first.message.content
    span.set_attribute("braintrust.output_json", JSON.generate(answer))
    puts "Received application answer: #{!answer.to_s.empty?}"
  end
ensure
  provider.force_flush
  provider.shutdown
end
```

Set `BRAINTRUST_API_KEY`, `BRAINTRUST_PROJECT`, `OPENAI_API_KEY`, and `OPENAI_MODEL`, then run `bundle exec ruby app.rb`. This application example makes a real provider request; use the credential-free smoke below for local verification instead.

Initialize before clients and spans are created. Keep existing customizers, placing the privacy policy after content-enriching customizers. `filter_ai_spans: false` includes ordinary task spans. Do not combine `span_customizers:` with an `exporter:` override; the SDK rejects that combination. Do not enable a raw console exporter alongside the protected exporter.

The provider's `force_flush` and `shutdown` are real OTel SDK methods returning export result codes. Short scripts should finish spans, explicitly flush, then shut down before exiting. The SDK also registers a flush-at-exit hook for its global provider, but explicit lifecycle management makes script completion unambiguous. In a server, keep the provider alive until application shutdown; do not shut it down per request. This cleanup does not add custom error handling.

## Credential-free local verification

Save as `smoke.rb` beside both policy files and run `bundle exec ruby smoke.rb`. This uses Minitest, the real Braintrust processor/exporter, real OpenAI client instrumentation, and a local HTTP receiver that decodes exported OTLP. Only the provider response is stubbed. No model call, credentials, or staging upload is needed. The explicitly authenticated local `Braintrust::State` avoids login discovery; production uses `Braintrust.init` above.

```ruby
# frozen_string_literal: true

require "openai"
require_relative "error_customizer"
require "minitest/autorun"
require "webrick"
require "zlib"
require "stringio"

class ExportPolicyTest < Minitest::Test
  SECRET = "synthetic-person@example.invalid"
  PARENT = "project_name:pii-local"

  # Independent fixtures, not expectations generated from the policy constants.
  JSON_FIELDS = %w[
    braintrust.input_json braintrust.output_json
    gen_ai.input.messages gen_ai.output.messages gen_ai.system_instructions
    llm.input_messages llm.output_messages
  ].freeze
  TEXT_FIELDS = %w[
    braintrust.input braintrust.output
    input output gen_ai.prompt gen_ai.completion llm.prompts llm.completions
    gen_ai.input.messages.0.content gen_ai.output.messages.0.content
    gen_ai.system_instructions.0.content gen_ai.prompt.0 gen_ai.completion.0
    llm.input_messages.0.content llm.output_messages.0.content llm.prompts.0 llm.completions.0
  ].freeze
  ERROR_FIELDS = %w[error braintrust.error exception.type exception.message exception.stacktrace error.message].freeze

  def attrs(span_or_event)
    span_or_event.attributes.to_h { |entry| [entry.key, entry.value.string_value] }
  end

  def test_conversation_only
    verify_export(PiiCustomizer.new, redact_errors: false)
  end

  def test_explicit_error_opt_in
    verify_export(ConversationAndErrorCustomizer.new, redact_errors: true)
  end

  def test_policy_edges
    policy = PiiCustomizer.new
    assert_nil policy.scrub_attributes(nil)
    assert_equal({"input" => "[REDACTED]"}, policy.scrub_attributes("input" => "{\"valid\":true}"))
    assert_equal({"braintrust.input" => "[REDACTED]"}, policy.scrub_attributes("braintrust.input" => "not JSON"))
    assert_equal({"safe" => SECRET}, policy.scrub_attributes("safe" => SECRET))
    once = policy.scrub_attributes("braintrust.input_json" => JSON.generate(SECRET))
    assert_same once, policy.scrub_attributes(once)
  end

  def policy_source(attributes:, events:, status: OpenTelemetry::Trace::Status.unset)
    data = OpenTelemetry::SDK::Trace::SpanData.new
    data.trace_id = "t" * 16
    data.span_id = "s" * 8
    data.parent_span_id = "p" * 8
    data.attributes = attributes&.freeze
    data.events = events&.each(&:freeze)&.freeze
    data.status = status
    data.freeze
  end

  def test_no_match_preserves_objects_and_nil
    [PiiCustomizer.new, ConversationAndErrorCustomizer.new].each do |policy|
      [nil, {}, {"input.child" => SECRET, "gen_ai.input.messages_extra" => SECRET}].each do |attributes|
        [nil, [], [
          OpenTelemetry::SDK::Trace::Event.new("gen_ai.user.message", nil, 1),
          OpenTelemetry::SDK::Trace::Event.new("gen_ai.choice", {"safe" => SECRET}.freeze, 2),
          OpenTelemetry::SDK::Trace::Event.new("unrelated", {"content" => SECRET, "message" => SECRET}.freeze, 3)
        ]].each do |events|
          source = policy_source(attributes: attributes, events: events)
          view = Braintrust::Trace::SpanExportData.new(source)
          result = policy.on_span_export(view)
          assert_same view, result
          if attributes.nil?
            assert_nil result.attributes
          else
            assert_same attributes, result.attributes
          end
          if events.nil?
            assert_nil result.events
          else
            assert_same events, result.events
          end
          events&.each_with_index do |event, index|
            assert_same event, result.events[index]
            if event.attributes.nil?
              assert_nil result.events[index].attributes
            else
              assert_same event.attributes, result.events[index].attributes
            end
          end
        end
      end
    end
  end

  def test_copy_on_write_preserves_source_in_both_modes
    [PiiCustomizer.new, ConversationAndErrorCustomizer.new].each do |policy|
      redact_errors = policy.is_a?(ConversationAndErrorCustomizer)
      nested = [SECRET].freeze
      attributes = {"input" => SECRET, "exception.message" => SECRET, "safe" => nested}.freeze
      events = [
        OpenTelemetry::SDK::Trace::Event.new("gen_ai.user.message", {"content" => SECRET}.freeze, 1),
        OpenTelemetry::SDK::Trace::Event.new("gen_ai.choice", {"message" => JSON.generate(SECRET)}.freeze, 2),
        OpenTelemetry::SDK::Trace::Event.new("exception", {"exception.message" => SECRET}.freeze, 3),
        OpenTelemetry::SDK::Trace::Event.new("unrelated", {"content" => SECRET}.freeze, 4),
        OpenTelemetry::SDK::Trace::Event.new("gen_ai.user.message", nil, 5),
        OpenTelemetry::SDK::Trace::Event.new("gen_ai.choice", {
          "input" => SECRET, "message" => JSON.generate(SECRET), "error.message" => SECRET
        }.freeze, 6)
      ]
      status = OpenTelemetry::Trace::Status.error(SECRET)
      source = policy_source(attributes: attributes, events: events, status: status)
      result = policy.on_span_export(Braintrust::Trace::SpanExportData.new(source))
      refute_same source, result
      refute_same attributes, result.attributes
      refute_same events, result.events
      assert_equal "[REDACTED]", result.attributes.fetch("input")
      assert_equal(redact_errors ? "[REDACTED]" : SECRET, result.attributes.fetch("exception.message"))
      assert_same nested, result.attributes.fetch("safe")
      assert_equal({"content" => "[REDACTED]"}, result.events[0].attributes)
      assert_equal({"message" => '"[REDACTED]"'}, result.events[1].attributes)
      assert_equal(redact_errors ? "[REDACTED]" : SECRET, result.events[2].attributes.fetch("exception.message"))
      assert_same events[2], result.events[2] unless redact_errors
      assert_same events[3], result.events[3]
      assert_same events[4], result.events[4]
      assert_nil result.events[4].attributes
      assert_equal({
        "input" => "[REDACTED]", "message" => '"[REDACTED]"',
        "error.message" => redact_errors ? "[REDACTED]" : SECRET
      }, result.events[5].attributes)
      assert_equal events.map(&:name), result.events.map(&:name)
      assert_equal events.map(&:timestamp), result.events.map(&:timestamp)
      assert_equal status.code, result.status.code
      assert_equal(redact_errors ? "[REDACTED]" : SECRET, result.status.description)
      assert_same attributes, source.attributes
      assert_same events, source.events
      assert_same status, source.status
      assert_equal SECRET, source.attributes.fetch("input")
      assert_equal SECRET, source.attributes.fetch("exception.message")
      assert_equal SECRET, events[0].attributes.fetch("content")
      assert_equal JSON.generate(SECRET), events[1].attributes.fetch("message")
      assert_equal SECRET, events[2].attributes.fetch("exception.message")
      assert_equal SECRET, events[5].attributes.fetch("input")
      assert_equal JSON.generate(SECRET), events[5].attributes.fetch("message")
      assert_equal SECRET, events[5].attributes.fetch("error.message")
      assert_equal SECRET, status.description
      view = Braintrust::Trace::SpanExportData.new(result)
      assert_same view, policy.on_span_export(view)
    end
  end

  def test_event_only_and_status_only_changes_preserve_nil_attributes
    source = policy_source(attributes: nil, events: [
      OpenTelemetry::SDK::Trace::Event.new("gen_ai.user.message", {"content" => SECRET}.freeze, 1)
    ])
    result = PiiCustomizer.new.on_span_export(Braintrust::Trace::SpanExportData.new(source))
    assert_nil result.attributes
    assert_nil source.attributes
    assert_equal "[REDACTED]", result.events.first.attributes.fetch("content")
    assert_equal SECRET, source.events.first.attributes.fetch("content")

    source = policy_source(attributes: nil, events: nil, status: OpenTelemetry::Trace::Status.error(SECRET))
    view = Braintrust::Trace::SpanExportData.new(source)
    assert_same view, PiiCustomizer.new.on_span_export(view)
    result = ConversationAndErrorCustomizer.new.on_span_export(view)
    assert_nil result.attributes
    assert_nil result.events
    assert_equal "[REDACTED]", result.status.description
    assert_equal source.status.code, result.status.code
    assert_equal SECRET, source.status.description
  end

  def verify_export(policy, redact_errors:)
    captured = Queue.new
    provider_requests = Queue.new
    server = WEBrick::HTTPServer.new(
      BindAddress: "127.0.0.1", Port: 0, Logger: WEBrick::Log.new(File::NULL), AccessLog: []
    )
    server.mount_proc("/otel/v1/traces") do |request, response|
      bytes = request.body
      bytes = Zlib::GzipReader.new(StringIO.new(bytes)).read if request["content-encoding"] == "gzip"
      captured << [request["x-bt-parent"], bytes]
      response["Content-Type"] = "application/x-protobuf"
      response.body = ""
    end
    server.mount_proc("/v1/chat/completions") do |request, response|
      provider_requests << JSON.parse(request.body)
      response["Content-Type"] = "application/json"
      response.body = JSON.generate(
        id: "chatcmpl-local", object: "chat.completion", created: 1, model: "local-model",
        choices: [{index: 0, message: {role: "assistant", content: SECRET}, finish_reason: "stop"}],
        usage: {prompt_tokens: 3, completion_tokens: 2, total_tokens: 5}
      )
    end
    thread = Thread.new { server.start }
    endpoint = "http://127.0.0.1:#{server.config[:Port]}"
    provider = OpenTelemetry::SDK::Trace::TracerProvider.new
    begin
      Braintrust::State.new(
        api_key: "local-key", org_id: "local-org", default_project: "pii-local",
        app_url: endpoint, api_url: endpoint, tracer_provider: provider,
        config: Braintrust::Config.new(span_customizers: [policy], filter_ai_spans: false)
      )
      Braintrust.auto_instrument!(only: [:openai])
      client = OpenAI::Client.new(api_key: "local-key", base_url: "#{endpoint}/v1", max_retries: 0)
      tracer = provider.tracer("pii-local")
      fixture = JSON_FIELDS.to_h { |key| [key, JSON.generate({nested: [SECRET]})] }
      fixture.merge!(TEXT_FIELDS.to_h { |key| [key, SECRET] })
      fixture.merge!(ERROR_FIELDS.to_h { |key| [key, SECRET] })
      fixture.merge!(
        "braintrust.error_json" => JSON.generate(SECRET),
        "braintrust.metadata" => JSON.generate({keep: SECRET}),
        "gen_ai.input.messages_extra" => SECRET, "input.child" => SECRET,
        "gen_ai.usage.input_tokens" => 3
      )
      original = fixture.dup
      expected_id = nil
      tracer.in_span("support.root", attributes: fixture) do |root|
        expected_id = [root.context.trace_id, root.context.span_id]
        root.add_event("content", attributes: fixture)
        %w[gen_ai.user.message gen_ai.assistant.message gen_ai.system.message gen_ai.tool.message].each do |name|
          root.add_event(name, attributes: {"content" => SECRET, "braintrust.input" => SECRET, "safe" => "keep"})
        end
        root.add_event("gen_ai.choice", attributes: {"message" => JSON.generate({content: SECRET}), "input" => SECRET})
        root.add_event("unrelated", attributes: {"content" => SECRET, "message" => SECRET, "output" => SECRET})
        root.add_event("gen_ai.user.message", attributes: {"safe" => "missing-content"})
        root.add_event("gen_ai.choice", attributes: {"safe" => "missing-message"})
        root.status = OpenTelemetry::Trace::Status.error(SECRET)
        response = client.chat.completions.create(
          model: "local-model", messages: [{role: "user", content: SECRET}]
        )
        assert_equal SECRET, response.choices.first.message.content
        tracer.in_span("input-only", attributes: {"braintrust.input_json" => JSON.generate(SECRET)}) {}
        tracer.in_span("output-only", attributes: {"braintrust.output_json" => JSON.generate(SECRET)}) {}
      end
      assert_equal OpenTelemetry::SDK::Trace::Export::SUCCESS, provider.force_flush
      assert_equal original, fixture
      assert_equal 1, provider_requests.size
      assert_equal SECRET, provider_requests.pop.fetch("messages").first.fetch("content")
      requests = []
      requests << captured.pop until captured.empty?
      refute_empty requests
      spans = requests.flat_map do |parent, bytes|
        assert_equal PARENT, parent
        decoded = Opentelemetry::Proto::Collector::Trace::V1::ExportTraceServiceRequest.decode(bytes)
        decoded.resource_spans.flat_map { |r| r.scope_spans.flat_map { |s| s.spans.to_a } }
      end
      assert_equal 4, spans.size
      root = spans.find { |span| span.name == "support.root" }
      assert_equal expected_id, [root.trace_id, root.span_id]
      assert_empty root.parent_span_id
      assert_equal :STATUS_CODE_ERROR, root.status.code
      assert_equal(redact_errors ? "[REDACTED]" : SECRET, root.status.message)
      assert_equal "content", root.events.first.name
      assert_operator root.events.first.time_unix_nano, :>, 0
      [attrs(root), attrs(root.events.first)].each do |attributes|
        JSON_FIELDS.each { |key| assert_equal '"[REDACTED]"', attributes.fetch(key), key }
        TEXT_FIELDS.each { |key| assert_equal "[REDACTED]", attributes.fetch(key), key }
        ERROR_FIELDS.each { |key| assert_equal(redact_errors ? "[REDACTED]" : SECRET, attributes.fetch(key), key) }
        assert_equal JSON.generate(redact_errors ? "[REDACTED]" : SECRET), attributes.fetch("braintrust.error_json")
        assert_equal JSON.generate({keep: SECRET}), attributes.fetch("braintrust.metadata")
        assert_equal SECRET, attributes.fetch("gen_ai.input.messages_extra")
        assert_equal SECRET, attributes.fetch("input.child")
      end
      assert_equal 9, root.events.size
      root.events[1, 4].each do |event|
        assert_equal({"content" => "[REDACTED]", "braintrust.input" => "[REDACTED]", "safe" => "keep"}, attrs(event))
      end
      assert_equal({"message" => '"[REDACTED]"', "input" => "[REDACTED]"}, attrs(root.events[5]))
      assert_equal({"content" => SECRET, "message" => SECRET, "output" => "[REDACTED]"}, attrs(root.events[6]))
      assert_equal({"safe" => "missing-content"}, attrs(root.events[7]))
      assert_equal({"safe" => "missing-message"}, attrs(root.events[8]))
      token_count = root.attributes.find { |entry| entry.key == "gen_ai.usage.input_tokens" }
      assert_equal 3, token_count.value.int_value
      spans.each do |span|
        assert_equal PARENT, attrs(span).fetch("braintrust.parent")
        assert_operator span.end_time_unix_nano, :>=, span.start_time_unix_nano
        next if span == root
        assert_equal root.trace_id, span.trace_id
        assert_equal root.span_id, span.parent_span_id
      end
      llm = attrs(spans.find { |span| span.name == "Chat Completion" })
      assert_equal '"[REDACTED]"', llm.fetch("braintrust.input_json")
      assert_equal '"[REDACTED]"', llm.fetch("braintrust.output_json")
      assert_equal 3, JSON.parse(llm.fetch("braintrust.metrics")).fetch("prompt_tokens")
      input_only = attrs(spans.find { |span| span.name == "input-only" })
      output_only = attrs(spans.find { |span| span.name == "output-only" })
      assert_equal '"[REDACTED]"', input_only.fetch("braintrust.input_json")
      refute input_only.key?("braintrust.output_json")
      assert_equal '"[REDACTED]"', output_only.fetch("braintrust.output_json")
      refute output_only.key?("braintrust.input_json")
    ensure
      provider.shutdown
      server.shutdown
      thread.join
    end
  end
end
```

The smoke checks serialized span/event fields, default error/status preservation, explicit error redaction, missing-field behavior, unchanged application input/output, IDs/parents, routing, and token metrics. Direct hook regressions also check frozen source spans/maps/events, nil attributes/events, unchanged-object reuse, event-only and status-only changes, and idempotence in both policies. It deliberately preserves synthetic content in metadata and near-match attributes: those are outside this policy. It does not establish server-side ingestion, streaming, eval-runner, or attachment behavior.
