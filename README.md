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
| [`agent-self-improvement`](./skills/agent-self-improvement/SKILL.md) | Turn an instrumented agent's production traces into an offline eval loop: mine bad traces, build a failure taxonomy, capture cases in a remote Braintrust dataset, write scorers and an eval, iterate on prompts/tools, and only then push online scorers. |

More skills will be added here over time.

## Repository layout

```
skills/
└── <skill-name>/
    └── SKILL.md   # YAML frontmatter (name, description) + markdown body
```

## Prerequisites

- A [Braintrust account](https://braintrust.dev).
- The [`bt` CLI](https://github.com/braintrustdata/bt) installed and authenticated
  (`bt setup`, or `BRAINTRUST_API_KEY` in CI). Individual skills may list more.

## Install

### GitHub CLI (recommended)

Requires [`gh`](https://cli.github.com) 2.90+ with the skill extension. Installs a skill
into the correct directory for your agent automatically:

```bash
# Pick your agent: claude-code | codex | cursor | gemini | antigravity
gh skill install braintrustdata/braintrust-skills agent-self-improvement --agent claude-code
```

### skills.sh

```bash
npx skills add braintrustdata/braintrust-skills
```

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
`agent-self-improvement` skill, e.g. *"write evals for my agent's first tool call"* or
*"set up a self-improvement loop for the routing decision"*. In Claude Code you can also
invoke a skill directly by name, e.g. `/agent-self-improvement`.

## License

[MIT](./LICENSE) © Braintrust Data, Inc.
