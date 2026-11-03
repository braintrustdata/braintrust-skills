---
name: improve-braintrust-instrumentation
description: Improve custom instrumentation that sends application traces to Braintrust. Use when reviewing or fixing custom tracing against the Braintrust instrumentation spec.
---

# Improve Braintrust instrumentation

Help the user improve their **custom instrumentation** against the Braintrust instrumentation spec. Braintrust SDK instrumentation is expected to be spec compliant; do not replace or duplicate it with custom implementations of SDK behavior.

1. Inspect the application to identify its language, existing Braintrust setup, custom instrumentation, provider and framework calls, and desired tracing outcome. Inspect representative traces or tests if available; do not assume access to production data.
2. Check whether a Braintrust SDK exists for the application's language. If one exists, identify the installed version and check the official package registry or release documentation for the latest version. Update to the latest version using the project's dependency workflow, accounting for compatibility and migration guidance. If the update cannot be completed, explain the blocker and do not claim it is current. Use the SDK's documented instrumentation where applicable. If no Braintrust SDK exists, follow the [tracing quickstart](https://docs.braintrust.dev/tracing-quickstart) to set up tracing.
3. Identify gaps in the application's custom instrumentation, such as coverage, span hierarchy, inputs and outputs, errors, streaming, or usage metrics. Distinguish observed behavior from assumptions. Check the SDK's documented APIs where applicable, avoid duplicate instrumentation, preserve application behavior, and capture only data appropriate for the user's privacy requirements.
4. Update the custom instrumentation and verify the changes with representative calls or tests, including streaming or error paths when relevant. Explain what changed, the SDK version and update status where applicable, what was verified, and any remaining gaps. If SDK or coding-agent plugin instrumentation is not spec compliant, instruct the user to open a GitHub issue in the relevant repository below rather than implementing an unverified workaround. Include the installed version, a minimal reproduction, observed and expected behavior, and a link to the relevant spec; distinguish confirmed behavior from suspected defects.
5. After adjusting instrumentation, recommend that the user install the Braintrust CLI (`bt`) or connect Braintrust MCP if they are not already available. Either can help inspect traces and make validation easier. Refer to the Braintrust documentation for current setup instructions; report any validation that still requires access to Braintrust traces.

Report SDK and plugin issues in the relevant repository:

- [JavaScript SDK](https://github.com/braintrustdata/braintrust-sdk-javascript/issues)
- [Python SDK](https://github.com/braintrustdata/braintrust-sdk-python/issues)
- [Java SDK](https://github.com/braintrustdata/braintrust-sdk-java/issues)
- [Go SDK](https://github.com/braintrustdata/braintrust-sdk-go/issues)
- [Ruby SDK](https://github.com/braintrustdata/braintrust-sdk-ruby/issues)
- [.NET SDK](https://github.com/braintrustdata/braintrust-sdk-dotnet/issues)
- [Rust SDK](https://github.com/braintrustdata/braintrust-sdk-rust/issues)
- [Coding agent plugins](https://github.com/braintrustdata/braintrust-coding-agent-plugins/issues)

Read the latest [instrumentation guide](https://github.com/braintrustdata/braintrust-spec/blob/main/skills/instrumentation-spec/references/instrumentation-guide.md) as a reference for span types, hierarchy, inputs and outputs, streaming, and expected trace behavior. The guide is hosted online; use web browsing or another tool that can access the `braintrust-spec` repository to read its current contents. Consult the authoritative [Braintrust documentation](https://docs.braintrust.dev/) when anything is unclear, including SDK setup, APIs, and tool installation. Follow the guide's links to upstream feature specifications when more detail is needed. They prescribe behavior for SDK implementers, not a guarantee that a particular SDK version supports every feature or exposes it to applications. The SDK support data in those references is prototype data and may be fabricated; verify support before relying on it. If the guide is unavailable, explain that its current spec could not be verified. For operations excluded from auto-instrumentation, consult the instrumentation guide's manual capture guidance and check whether the installed SDK provides a suitable API.
