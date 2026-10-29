# Braintrust skills

Agent-agnostic [Agent Skills](https://agentskills.io) for working with
[Braintrust](https://braintrust.dev) — LLM evaluation, logging, and observability — from
your AI coding agent.

Each skill is a plain [Agent Skills](https://agentskills.io) file (YAML frontmatter plus a
markdown body). The same `SKILL.md` works across Claude Code, Codex, Cursor, Gemini CLI,
GitHub Copilot, opencode, and any other tool that reads the open skill format.

## Available skills

| Skill | Description |
| --- | --- |
| [`agent-auto-improvement`](./skills/agent-auto-improvement/SKILL.md) | Turn an instrumented agent's production traces into an offline eval loop: mine bad traces, build a failure taxonomy, capture cases in a remote Braintrust dataset, write scorers and an eval, iterate on prompts/tools, and only then push online scorers. |
| [`skill-health`](./skills/skill-health/SKILL.md) | Measure how coding agents load and use a repo's skills from coding-agent traces in Braintrust (context cost, reloads, what goes wrong after loading), capture the failures in a Braintrust dataset for evals, fix the weakest skills, and re-check after changes ship. |
| [`pii-scrubbing`](./skills/pii-scrubbing/SKILL.md) | Connect the export hook and traverse span fields, then apply the requested scrubbing logic or ask if unspecified. Includes LLM message-redaction examples for Python/TypeScript native and OpenTelemetry, Java, Go, and Ruby. |

More skills will be added here over time.

## Repository layout

```
skills/
└── <skill-name>/
    ├── SKILL.md   # YAML frontmatter (name, description) + markdown body
    └── references/ # Optional language examples and detailed guidance
```

## Prerequisites

- A [Braintrust account](https://braintrust.dev).
- For `agent-auto-improvement`, the [`bt` CLI](https://github.com/braintrustdata/bt)
  installed and authenticated (`bt setup`, or `BRAINTRUST_API_KEY` in CI).
- For `skill-health`, coding-agent traces in a Braintrust project (via the Braintrust
  coding-agent plugins or `bt trace`), and a way to run SQL against it (Braintrust MCP or `bt`).
- For the automation, evaluator, Topics, and Patterns workflows, an authenticated
  Braintrust MCP connection exposing the tools named in the skill, with access to
  the target project. Installing a skill does not install or enable those tools.
- For the Patterns Slack digest, a sandbox with Python 3 and a configured Slack
  delivery action. The digest follows Patterns analysis; it does not investigate traces.

Individual skills describe required approvals, integrations, and optional UI tools.
`braintrust-bro` does not require Braintrust tools.

## Install

### GitHub CLI (recommended)

Requires [`gh`](https://cli.github.com) 2.90+ with the skill extension. Installs a skill
into the correct directory for your agent automatically:

```bash
# Pick your agent: claude-code | codex | cursor | gemini | antigravity
gh skill install braintrustdata/braintrust-skills agent-auto-improvement --agent claude-code
```

### Vercel Skills (`npx skills`)

Use the [Vercel Skills CLI](https://github.com/vercel-labs/skills) from the project where
you want to use the skills. Requires Node.js 22.20+ and npm.

```bash
# Browse the skills in this repository without installing
npx skills add braintrustdata/braintrust-skills --list

# Choose skills and target agents interactively
npx skills add braintrustdata/braintrust-skills

# Install one skill for a specific agent
npx skills add braintrustdata/braintrust-skills --skill agent-auto-improvement --agent claude-code

# Install across projects instead of only in the current project
npx skills add braintrustdata/braintrust-skills --global
```

Project installation is the default. Use `--skill pii-scrubbing` to select the other
skill, or `--agent codex` to target Codex.

### Sentry dotagents

Use [dotagents](https://docs.sentry.io/ai/dotagents/) to declare skills as project
dependencies in `agents.toml` and pin their versions in `agents.lock`. Run these commands
from your project's root:

```bash
# Initialize once for a project that does not yet have agents.toml
npx @sentry/dotagents init

# Add either or both skills from this repository
npx @sentry/dotagents add braintrustdata/braintrust-skills --name agent-auto-improvement
npx @sentry/dotagents add braintrustdata/braintrust-skills --name pii-scrubbing

# Install the declared dependencies
npx @sentry/dotagents install
```

Set the `agents` field in `agents.toml` to your target tools, for example
`agents = ["claude", "codex"]`. dotagents installs skills into `.agents/skills/` and
creates the appropriate agent links; run `npx @sentry/dotagents sync` after changing
agent targets.

Commit `agents.toml` and `agents.lock` so teammates can restore the same versions with
`npx @sentry/dotagents install --frozen`. By default, dotagents also expects installed
skills to be committed; set `gitignore = true` in `agents.toml` if you prefer to install
them after cloning.

### Manual / symlink

Clone the repo and run the bundled installer. It installs every skill under `skills/` into
the agent-agnostic `.agents/skills/` directory (copy by default, or symlink with `--link`),
and can alias agent-specific directories to it:

```bash
git clone https://github.com/braintrustdata/braintrust-skills
cd braintrust-skills

./install.sh                      # install all skills into ./.agents/skills (project scope)
./install.sh --global             # install into ~/.agents/skills
./install.sh --agent claude       # also create a .claude/skills alias → .agents/skills
./install.sh --link               # symlink instead of copy (tracks repo updates)
```

`.agents/skills/<name>/SKILL.md` is the vendor-neutral location most agents read directly;
agent-specific directories (`.claude/skills`, `.gemini/skills`, `.copilot/skills`, …) can
symlink to it. To install a single skill by hand, copy its folder from `skills/` into your
agent's skills directory.

## Using a skill

Once installed, ask your agent to do the thing the skill describes — for the
`agent-auto-improvement` skill, e.g. *"write evals for my agent's first tool call"* or
*"set up an auto-improvement loop for the routing decision"*. In Claude Code you can also
invoke a skill directly by name, e.g. `/agent-auto-improvement`.

## License

[MIT](./LICENSE) © Braintrust Data, Inc.
