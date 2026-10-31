# Feedback tool design

## Default input

Require a nonblank `message`; make `context` and each of its members optional. Validate and bound strings using the application's conventions. Suggested `type` values:

- `bug`: behavior appears broken.
- `friction`: confusing parameters, documentation, or errors.
- `missing_capability`: no available tool supports the needed action.
- `other`: feedback that doesn't fit those categories.

```json
{
  "message": "The deployment error didn't name the missing environment variable",
  "context": {
    "tool": "deploy_to_vercel",
    "task": "Deploy a preview",
    "expected": "An error identifying the missing variable",
    "actual": "Build failed without naming the variable",
    "type": "bug"
  }
}
```

A missing-capability report can omit `tool`, `expected`, or `actual`; don't make agents invent a failed call to submit one. Avoid requiring ratings or a severity guess. If error codes or triggering call IDs are useful, add optional fields and populate known metadata on the server.

For an existing `feedback: string` tool, keep compatibility. Discuss whether to add optional `context` or stay with prose; analysis must use the actual `input.feedback` path rather than the default `input.message`.

## Tool description and behavior

Propose wording along these lines, adjusted to the agreed invocation policy:

> Record feedback about this MCP server: a tool problem, confusing contract, or missing capability, including when a workaround let you finish. State the task, what you expected, and what happened; name the affected tool when one exists. Report separate problems separately. Omit credentials, personal information, and full conversations. This records a report for the team; it does not add capabilities or promise a response. Do not report your own corrected argument mistakes as server bugs, and do not recursively report failures of this feedback tool.

For user-requested feedback, add that it runs only when the user asks to share feedback. For agent-initiated reports, state the agreed triggers explicitly. Do not hard-code permission bypass instructions from Braintrust's own tool into a customer's tool.

Prefer storing the report through the existing traced MCP call when that is a reliable recording path. A successful in-memory handler response alone does not prove the report was retained. If stronger acknowledgement is needed, use the application's supported durable write or flush behavior. Reuse existing authentication and feedback destinations.

Set MCP annotations to reflect the implementation. A tool that persists a report should normally advertise `readOnlyHint: false`, `destructiveHint: false`, and `idempotentHint: false` unless it deduplicates repeated submissions. Set `openWorldHint` according to the actual destinations. Do not copy Braintrust's annotations without considering the recording behavior.

Record the exact tool name, message/context paths, span name, sampling/content settings, and available correlation fields for the Patterns configuration. A report count is a count of reports, not a tool failure rate.
