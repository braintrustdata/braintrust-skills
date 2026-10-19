---
name: braintrust-overview-slack-digest
description: Format completed Overview dashboard insights as one Slack digest and deliver it through the automation's configured Slack actions. Use after dashboard publication; do not perform a separate analysis or use for Patterns digests.
---

# Overview Slack digest

Present the same content as this run's Overview dashboard in a readable Slack message. The dashboard instructions govern the analysis and wording; this skill only changes presentation.

## Use the completed dashboard content

Finish every target's `publish_dashboard_section` or `fail_dashboard_section` call before composing the digest. Use only accepted publication results. For a target accepted as unchanged, use its previous published insight from the dashboard run details. Keep targets in their configured order.

Use each insight's `insightTitle` as its heading, or the configured target title when it has no insight title. Preserve `content.summaryMessage`, trace labels, and pattern impact text. Do not rewrite, rank, shorten, recompute metrics, investigate traces, or introduce additional findings, recommendations, or a second summary. The digest may repeat unchanged insights; a routine scheduled digest does not require new findings.

If a section failed, show its title with “Could not refresh this section.” Do not present its previous content as newly generated. If all sections failed, send a short failure notice with the Overview link instead of a normal digest. If a section has no explicit outcome, complete its publication or failure call first. Do not invent content when evidence is missing.

## Format for Slack

Use Slack mrkdwn, with blank lines between sections:

- Start with `*Overview digest*` and the analysis window's dates from the dashboard run details. The delivery service adds the project name; do not add a second project header.
- Give each section a `*bold title*`, then its existing summary text. Convert Markdown formatting and links to Slack syntax while preserving the wording and numerical values.
- For trace insights, put each trace on its own bullet using `<overview_url/logs?r=encoded_root_span_id|trace label>`.
- For pattern insights, put each pattern on its own bullet using `<overview_url/patterns/encoded_pattern_id|pattern impact text>`. Use an existing pattern title if the run already has it; do not fetch or invent a new title.
- Finish with `<overview_url|Open Overview in Braintrust>`, using the exact `overview_url` from the run details. The supplied URL is the project root; append only the paths above to build evidence links, encoding IDs as URL components.

Escape `&`, `<`, and `>` in plain text and link labels while preserving Slack link delimiters. Use bullets and line breaks instead of Markdown tables or code blocks. Omit the dashboard's interactive follow-up buttons and their prompts. Do not add an extra highlights section or commentary about the analysis process.

## Deliver

Call `deliver_automation_action` once for each configured Slack action with the provided `automation_id` and `action_index`, and the formatted text in the top-level `message` field. Do not use `additional_message_key`. The destination, credentials, retries, and deduplication are owned by the automation delivery tool; do not send through another Slack tool or choose a different channel.
