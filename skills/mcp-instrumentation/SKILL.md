---
name: mcp-instrumentation
description: "Instrument a JavaScript, TypeScript, or Python MCP server with Braintrust, preferring automatic SDK instrumentation and verifying real MCP traces. Discuss optional agent intent parameters and a send_feedback tool, then offer intent Topics and feedback Patterns. Ask permission between workflow steps. For other server languages, direct the user to Braintrust for implementation help."
---

# Instrument an MCP server with Braintrust

Trace what an MCP server does, capture why agents use it, and give agents a way to report problems and missing capabilities. This skill is for servers the user builds, rather than connecting an MCP client to Braintrust's hosted MCP server.

## Work in approved steps

**After every numbered step, summarize its result and ask permission to continue. Wait for an explicit answer before starting the next step.** Explain the concrete next action. A skipped optional feature is a valid result; proceed to the next decision only with permission. Do not treat silence or approval of instrumentation as approval of schema changes, feedback collection, or recurring analysis.

At decision points, present a concrete recommendation before asking. Do necessary read-only inspection and prepare a reviewable proposal first. Within an approved step, complete its implementation and verification without asking about every command. Honor preferences already given; if the user explicitly approves several named steps together, that approval covers those steps.

Keep a small record of the target project, setup method, verified trace links, selected intent tools and field path, feedback tool and input paths, skipped options, and approvals. Use it to adapt analysis prompts and the final handoff.

Read current linked docs before changing SDK setup; package support and commands can change. If the docs page is hard to retrieve, try its `.md` version. Discover Braintrust tools or inspect `bt --help` and subcommand help before using them. Reuse existing credentials and project configuration; never ask for API keys in chat.

## 1. Inspect the server and choose SDK setup

Inspect the server entry points, runtime/language, MCP framework and versions, package manager, transport, launch/deployment commands, existing Braintrust logger, and instrumentation bootstrap. Identify the intended Braintrust organization/project from configuration or ask if it cannot be inferred.

This workflow supports **JavaScript/TypeScript and Python MCP servers only**. For any other server language, explain that this MCP integration isn't supported by this skill and ask the user to reach out to [Braintrust](https://www.braintrust.dev/contact) for implementation help. Other Braintrust language SDKs do not imply MCP support. Do not port the wrappers or claim generic spans are equivalent MCP instrumentation.

For a supported server, prefer the language's SDK quickstart:

- [JavaScript/TypeScript quickstart](https://docs.braintrust.dev/sdks/typescript/quickstart)
- [Python quickstart](https://docs.braintrust.dev/sdks/python/quickstart)

The quickstart currently launches an interactive, agent-assisted setup wizard. When it needs the user's terminal or starts another coding-agent session, give the exact command from the current docs and ask the user to run it **from their application directory**, finish setup, then return to this coding-agent session. Do not start a nested coding agent from this skill. Preserve already working setup instead of rerunning it.

Use [the instrumentation reference](references/instrumentation.md) to explain the automatic approach and manual fallback. If the user cannot use the wizard, propose SDK setup directly in this session with automatic instrumentation preferred.

**Checkpoint:** Report the detected stack, existing setup, target project, and recommended setup path. Ask permission to perform setup, or have the user run the quickstart and return. Their report that setup is complete allows inspection of its results; still ask before proceeding to MCP verification in step 2.

## 2. Verify automatic MCP tracing; add it manually if needed

Once setup is approved, complete or inspect the SDK setup before verifying the server. An agent-assisted quickstart is a setup method; it is not evidence that the runtime uses automatic instrumentation.

With supported versions and active automatic instrumentation, MCP tracing should already be included. Check the **actual server process and launch path**, then exercise a harmless tool over the real MCP transport. Confirm a fresh server span named `tools/call <tool>` in the chosen project's Logs, with the expected arguments, result, timing, and request metadata. Check errors with an existing safe failure case where practical. LLM traces alone do not prove MCP instrumentation works.

If the MCP span is missing, inspect initialization order, versions, loader/bundler configuration, instrumentation opt-outs, project routing, and flushing. Fix automatic setup when feasible; otherwise add the documented manual server wrapper. Use the same logger/project and avoid wrapping again when MCP traces already exist. Read [the instrumentation reference](references/instrumentation.md) for exact APIs and verification details.

Report whether SDK setup was wizard-assisted or direct, and whether MCP tracing is automatic, manual, or mixed across server entry points. If credentials or a runnable environment are unavailable, state what was checked locally and what still needs a live trace; do not claim delivery was verified.

**Checkpoint:** Show what is traced, the instrumentation method, verification evidence, and any remaining limitation. Ask permission to discuss intent capture.

## 3. Discuss and optionally add agent intent

Explain that a short agent-supplied intent captures the task and why the product was chosen, beyond the mechanical tool arguments. Recommend `telemetry.intent`, but an existing `intent`, `context`, or another descriptive field is fine.

Inspect tool schemas and recommend a **specific subset** of tools where intent would explain meaningful product use: for example, search, analysis, creation, or deployment tools. Avoid adding it to every tool by default. Discuss the exact tools, field name, and whether it is optional or required before editing. Default to optional for compatibility with existing clients; do not impose a new required argument without approval.

Suggested field description:

> Briefly describe the wider task and why this tool was chosen. Omit argument values, personal information, and secrets.

Example: `{"telemetry":{"intent":"Compare p95 latency across two assistant versions"}}`.

Keep intent in the **recorded tool input**, but separate it from business arguments before invoking underlying APIs. Never use it for authorization or business decisions. Existing masking and content-capture settings may prevent recording it; inspect the actual span instead of assuming it survived. Do not override those settings without agreement.

After approval, implement only the selected schemas and verify both discovery (`tools/list`) and execution (`tools/call`), including omission of optional intent. Confirm the stored intent path. Braintrust's [server registration](https://github.com/braintrustdata/braintrust/blob/main/api-ts/src/mcp/mcp-server.ts) is an example of separating telemetry from business arguments, not a requirement to copy its global schema injection or required-field policy.

Declining intent is fine; record the choice and omit intent Topics from the handoff.

**Checkpoint:** Report the chosen tools/field and verification, or that intent was skipped. Ask permission to discuss an agent feedback tool.

## 4. Discuss and optionally add a feedback tool

Recommend a tool named `send_feedback` that lets agents report product problems, confusing contracts, and missing capabilities. Reuse an equivalent existing tool; its name can differ. Explain that this adds a report channel, and the caller's report is not proof of the suspected cause.

Read [feedback design](references/feedback-design.md). The recommended default is a required `message` plus optional structured `context` with `tool`, `task`, `expected`, `actual`, and `type`. Keep context optional so agents can report a missing capability even when no tool exists. Reuse an existing compatible schema when appropriate.

Before editing, show the proposed name, input schema, tool description, recording destination, and when agents should call it. Agree whether reports are user-requested or may be agent-initiated under the product's existing policy. Do not copy another server's consent behavior without discussing it. Adding a tool does not itself authorize new external ticketing, email, or Slack delivery.

After approval, implement the tool in the traced server. The existing MCP span can be the feedback record if its inputs are captured and retained. If content is disabled or sampled, agree a reliable recording path rather than returning a misleading success message. The tool should acknowledge only what was actually recorded, without promising a fix or human response. Derive available client/server/session metadata on the server instead of asking agents to reconstruct it. Preserve existing links to triggering calls when available; do not invent trace IDs or require a triggering tool for capability gaps.

Verify discovery and one clearly labeled synthetic feedback call, then inspect the stored message, structured context, and any correlation fields. Run the relevant existing schema/handler checks. Keep that synthetic report out of later organic findings. Do not build a new feedback service just to implement this step.

Declining feedback is fine; record the choice and omit feedback Patterns from the handoff.

**Checkpoint:** Report the tool/schema/destination and verification, or that feedback was skipped. Ask permission to prepare the summary and applicable analysis recommendations.

## 5. Summarize and offer the matching analysis

Give a concise handoff containing:

- What SDK and MCP operations were instrumented, and the relevant files/launch commands.
- Whether setup was wizard-assisted or direct, and MCP tracing automatic or manual.
- A **verified link to the actual Braintrust project**, plus a representative trace when available. Resolve it from configuration, a successful tool/CLI response, or the user; do not invent the project URL. If unresolved, state that and ask for the project link.
- Intent tool coverage/field and feedback tool/schema, including skipped features.
- What was verified and any remaining runtime check.

If intent was added, explain [Topics](https://docs.braintrust.dev/observe/topics) and recommend an **MCP intent** custom facet using [the supplied prompt](references/intent-facet-prompt.txt). Offer to prepare its configuration with a preprocessor that reads only the actual intent path, then ask permission before saving or enabling it.

If feedback was added, explain [Patterns](https://docs.braintrust.dev/observe/patterns) and recommend a feedback-focused Patterns automation using [the supplied investigation instructions](references/feedback-pattern-instructions.md), adapted to the actual tool and input paths. Offer an automation-specific severity/category rubric if useful. Ask permission before saving a rubric, configuring/enabling an automation, or running analysis.

Use [the analysis setup reference](references/analysis-setup.md) for CLI support, preprocessing, approval boundaries, rubric handling, and UI fallbacks. Show the exact proposal, project, automation, and expected changes before applying it. Do not silently replace an existing general Patterns job or project rubric. Topics and Patterns are independent; only offer the ones supported by the features the user chose.

**Checkpoint:** Ask which applicable analysis step, if any, the user wants next. After each approved analysis step, summarize the saved result and ask before continuing. If they decline, finish with the instrumentation summary.
