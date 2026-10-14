---
name: braintrust-automations-workflow
description: Set up, validate, and manage Braintrust alerts and scheduled Loop automations, including Patterns, threshold-triggered work, Slack or webhook delivery, and existing automation refinement. Use when a user asks to react to matching log or environment events, monitor a threshold, schedule recurring agent analysis, configure Patterns, or inspect an alert or Loop automation.
---

# Braintrust automations workflow

Automations allow users to run work when certain events occur or periodically in the background, and then perform actions like posting to Slack, sending a webhook, or performing follow ups within the Braintrust platform.

Common use cases for automations include:

- Posting in Slack every time a certain log event occurs (eg. thumbs down) or if a query value reaches some threshold (avg score in the past 15 minutes is above X)
- Built-in product features like Topics (which clusters traces to find trends) and Patterns (recurring issues or trends from your traces) run on a schedule (usually daily)
- More general-purpose recurring automations (look at cost from the past day and report on it). You can use Loop with a relatively simple prompt to express an infinite number of such use cases.
- Export automations allow you to write data to cloud storage like S3 or GCS.
- Retention automations allow you to delete data after some amount of time.

Online scoring and Topics classification are relatively complex built-in automations, so follow their dedicated skills. Configure Patterns with the exact scheduled Loop recipe in this guide so it is recognized and managed as Patterns rather than as an ordinary Loop job.

### Resolving Slack delivery

Any automation with a Slack action must set `workspace_id` and `channel` to a real Slack workspace ID and channel ID. Never guess these or reuse an ID that appears elsewhere in the conversation. Call `list_slack_channels` for the project with the user's requested channel name as `query`. If it returns multiple workspaces, ask the user to choose one, then call it again with that `workspace_id`. Use a returned channel only when its name exactly matches the requested channel name, case-insensitively, and it is the only exact match. Otherwise ask the user for clarification or the channel ID. Confirm the resolved channel name back to the user before creating the automation.

The current MCP can inspect but has no creation or configuration-update tools for Topics digests, scheduled exports, or retention policies. When asked to configure one, first use `search_docs` to retrieve the current official instructions. Then provide prerequisites and tailored, numbered setup steps, and explain that the current MCP cannot perform the write. Include the relevant documentation links as references instead of redirecting the user to find and interpret the instructions.

## How automations work

Automation types you can configure directly with MCP tools include:

- Log automations trigger when a matching event occurs, eg when a user saves a :thumbsdown:.
- Environment automations trigger when someone updates an environment tag, such as changing the production version of a prompt.
- Windowed automations run on a schedule and may use a numeric threshold, Loop work, or both. A breached threshold can gate Loop investigation and delivery actions.
- Scheduled Loop jobs run agent instructions for every scheduled window without a threshold.
- Patterns is a specialized scheduled Loop job that writes representative recurring patterns with the Patterns tools.

Other user-facing automation families include Topics digests, scheduled exports, and retention policies. They remain visible through `list_automations`, but the current MCP cannot create or reconfigure them.

## The ideal process

When a customer asks for help setting up an automation, you should:

### Understand what they want to automate

Fundamentally you need to understand:

1. What triggers the automation
2. Once triggered, what should it produce
3. What actions does it take with the produced result?

You should inspect the existing automations before creating another one. The user's task might already be covered or be an edit to an existing one. For example, someone might ask to make a particular automation less noisy, in which case you may want to edit its definition. Once you understand each of the 3 steps and whether this should be an edit or a new automation, present your findings to the user.

### Validate the input and behavior

If the automation involves analyzing the data (eg checking if a score meets some threshold), then poke around the current data (and use schema inference to understand the shape of the data). Do not guess at field names or create an automation around logic that has not produced meaningful results on current data.

### Choose the automation type

#### Scheduled Loop jobs

Use `create_scheduled_loop_job` when Loop should investigate or summarize every scheduled window without a threshold.

#### Patterns

Patterns is the most common scheduled Loop job. Use it when the user wants recurring issues or trends discovered from project traces. Call `create_scheduled_loop_job` with the user-approved schedule and window. Use the current default Codex model. Unless the user asks otherwise, run at 9 AM on weekdays in their timezone and deliver results to Slack. Resolve the Slack workspace and channel with `list_slack_channels` before creation (see "Resolving Slack delivery" above).

Use `braintrust-pattern-analysis` as the source of truth for Patterns analysis. The scheduled prompt below loads it. Omit `formatting_prompt` from the Slack action so the runtime applies the current Patterns Slack formatting instructions; set it only when the user explicitly requests custom formatting. Preserve these Patterns-specific fields:

```yaml
event_type: windowed
product_origin: patterns
status: active
loop:
  prompt: |
    Load and follow `braintrust-pattern-analysis`. Autonomously investigate the current automation window and create or update the representative set of material patterns.
  include_trigger_input: false
  agent_slug: loop-chat
  auto_approve_tools:
    - new_pattern
    - update_pattern
  harness: codex
  reasoning_effort: xhigh
actions:
  - type: slack
    workspace_id: SELECTED_SLACK_WORKSPACE_ID
    channel: SELECTED_SLACK_CHANNEL_ID
```

#### Log alerts

Use `create_log_alert` for individual matching spans. Its `btql_filter` is a boolean filter expression, not a `SELECT` query.

#### Environment-update alerts

Use `create_environment_update_alert` for environment changes.

#### Threshold alerts

Use `create_threshold_alert` when a numeric condition gates execution, including counts, rates, averages, percentages, and percentiles. The query should return at most one row with the configured numeric value column. Put minimum sample-size logic in the query, but let the alert runtime supply the time window. A threshold alert may deliver actions directly or invoke Loop after the condition is breached.

### Configure the automation

Align on scope, filters, sampling, window, schedule, evaluation delay, status, and any delivery actions. For alerts, also align on pending behavior, reminders, recovery notifications, and what should happen when there is no data.

For online scoring and Topics classification, configuring or enabling processing for new traffic and rewinding historical data are separate mutations. Treat a rewind as separately authorized and explicitly scoped. Alerts, scheduled Loop jobs, Patterns, Topics digests, exports, and retention policies do not use this rewind workflow.

### Create and show the automation

Before creating the automation, summarize its type, input, scope, schedule, behavior, and output. If the user's request already authorizes creation, proceed to the appropriate tool call. The mutating tool's approval UI is the confirmation surface; do not ask for a redundant typed confirmation.

Use `show_in_workspace` with `type: "automation"` when it is available so the user can inspect the saved configuration.

### Exit criteria

Before wrapping up, check that the automation has a useful outcome. This may be a Slack or webhook action or a write tool. There is currently no in-app feed for alerts. If it is unclear how the result should be used or delivered, clarify with the user.
