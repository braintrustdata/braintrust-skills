# SDK setup and MCP verification

Read the current [MCP SDK integration](https://docs.braintrust.dev/integrations/sdk-integrations/mcp-sdk) and the language quickstart before changing code. These examples show the integration points; preserve the application's framework imports, package manager, transport, logger, and deployment conventions.

## Quickstart handoff

The quickstarts currently give these commands. Recheck them before presenting them:

```bash
# JavaScript/TypeScript — run in the application repository
curl -fsSL https://braintrust.dev/wizard/setup.sh | sh -s -- --from docs_typescript_quickstart
```

```bash
# Python — run in the application repository
curl -fsSL https://braintrust.dev/wizard/setup.sh | sh -s -- --from docs_python_quickstart
```

The wizard uses Claude Code or Codex to inspect and instrument the app. Tell the user to finish its interactive setup and return to the current session. On return, inspect its changes and confirm the configured project. Check whether `bt` was installed with `command -v bt` and `bt --help`; do not assume installation or authentication succeeded.

If the wizard is unavailable, use the current [TypeScript install guide](https://docs.braintrust.dev/sdks/typescript/install-and-instrument) or [Python install guide](https://docs.braintrust.dev/sdks/python/install-and-instrument). Prefer automatic instrumentation in that direct setup too.

## JavaScript/TypeScript

Automatic MCP server tracing uses an initialized logger and the Braintrust import hook in the process that actually runs the server:

```javascript
import { initLogger } from "braintrust";
initLogger({ projectName: "<project>" });
```

```bash
node --import braintrust/hook.mjs dist/server.js
```

Adapt the real launch command, environment loading, and TypeScript loader/bundler as documented. Editing an unused npm script will not instrument a deployment that launches another entry point. Check that `BRAINTRUST_DISABLE_INSTRUMENTATION` doesn't exclude `mcp`.

If automatic tracing cannot be made to work, use the manual wrapper on the existing server:

```typescript
import { wrapMCPServer } from "braintrust";
wrapMCPServer(server);
```

Reuse or initialize the logger once. `wrapMCPServer` accepts a high-level MCP server or a low-level Server and returns the same instance. It traces handlers registered before and after wrapping. Do not migrate an existing v1 MCP server to v2 just to match a documentation example.

At the time this skill was written, the docs require Braintrust >=3.42.0 and support `@modelcontextprotocol/sdk` >=1.2.0,<2 or `@modelcontextprotocol/server` >=2,<3. Recheck current support and installed versions. TypeScript MCP clients are not automatically traced by this integration.

## Python

Automatic instrumentation initializes the logger and enables instrumentation once, before serving:

```python
import braintrust

braintrust.init_logger(project="<project>")
braintrust.auto_instrument()
```

If it already exists, inspect its MCP settings instead of adding another bootstrap. MCP client and server instrumentation are enabled by default; `mcp_server=False` is an opt-out. Use `mcp_client=False` if server-only tracing is appropriate.

For the manual fallback, wrap the existing server:

```python
from braintrust.integrations.mcp import wrap_mcp_server

wrap_mcp_server(server)
```

The wrapper supports the official SDK's low-level Server, bundled FastMCP/MCPServer, and standalone FastMCP. At authoring time, the docs require Braintrust >=0.49.1 and support `mcp` >=1.28.1,<3 or standalone `fastmcp` >=2.14.7,<5. Recheck these versions rather than forcing a framework migration.

## Verify the real path

Use an existing MCP client or the project's integration harness to initialize the connection, list tools, and call a harmless tool through the actual transport. Verify a fresh **server** `tools/call <tool>` span in the target project; a Python client span alone isn't enough. Compare the response and stored input/output with the call you made. Exercise a safe failure if available, and ensure behavior is unchanged.

Use the application's normal flush/shutdown handling and inspect stored data after flushing. Keep stdout free of diagnostics for stdio servers. Check a unique test argument or captured trace ID so older data cannot appear to validate the new setup. Check duplicate server spans if multiple instrumentation mechanisms are present.

Tool calls, prompt requests, resource reads, and other supported MCP protocol operations are traced; exact coverage varies by language/version. Do not claim coverage of methods that the current integration doesn't trace. Request spans can start separate traces. Cross-trace correlation needs real propagated context or recorded session/conversation links; do not assume every call from an agent shares a trace.

Arguments and results are captured by default, subject to configured content capture and masking. Intent and feedback analysis require their fields to survive the real export path. Preserve existing policy; discuss a narrow alternative when those fields are absent.
