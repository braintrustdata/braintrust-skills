---
name: skill-health
description: "Measure how coding agents actually use a repo's skills from coding-agent traces in Braintrust: which skills load, what they cost in context, and whether the work after a load goes wrong. Capture the failures in a Braintrust dataset, slim and fix the worst skills, and re-check after the change ships. Use when the user wants to audit, improve, diet, or track the effectiveness of agent skills (SKILL.md files) with Braintrust data, or re-check a skill after a change."
---

# Skill health from Braintrust coding-agent traces

Use coding-agent traces in Braintrust to find the repo skills that cost the most or go wrong most often, capture the failures in a dataset, and fix the skills. The dataset grows with each run, so every fix can be evaluated against all past failures.

## Inputs

Ask for anything you cannot infer:

- The Braintrust project holding the coding-agent traces (a logs URL is easiest).
- The repo as `owner/name`.
- The time window. Use the dates the user gives; otherwise the last 30 days.
- A local clone of that repo, for skill files and their history.
- Where datasets live. Default one dataset per skill, `skill-health-<skill>`, in the trace project.

## Querying Braintrust

Use whatever Braintrust tools you have to query logs with SQL and to manage datasets: look through your available tools, or run `bt --help`. Read their help before the first call, because row limits differ.

The fields that matter:

- `metadata.skill_name`: skill loaded by this tool span
- `metadata.skill_path`: file read. Exec/read loads have it; Claude Code `Skill` calls often don't
- `metadata.tool_name`: `Skill` (Claude Code), `exec` (Codex), `read`/`skill` (Pi and others)
- `metadata.skill_load_trigger`: `explicit` when the user invoked the skill. Unset means the model chose it, or the agent doesn't report it
- `metadata.git_origin_url`: repo, as `https://.../owner/name.git` or `git@...:owner/name.git`
- `metadata.git_commit_sha`: repo commit the session ran on
- `Turn N` / `turn: <id>` task spans: one per user turn. `input` holds the user message when the agent records it
- `error`: tool failure

A load is one span that loaded the skill, and a session is one `root_span_id`. In the queries below, `<time>` is `created >= 'START' AND created < 'END'`, with the window's dates as `YYYY-MM-DD`, and `<repo>` is:

```sql
(metadata.git_origin_url ILIKE '%OWNER/NAME.git' OR metadata.git_origin_url ILIKE '%OWNER/NAME')
```

The query linter blocks aggregating over `input`/`output` (filter on them instead) and sorting by `metrics.start` (sort by `created`). Select lightweight fields, not whole payloads.

## 1. Measure usage

```sql
SELECT metadata.skill_name AS skill, count(1) AS loads, count(DISTINCT root_span_id) AS sessions,
       count(DISTINCT span_attributes.created_by_user_id) AS users,
       sum(CASE WHEN metadata.skill_load_trigger = 'explicit' THEN 1 ELSE 0 END) AS explicit_loads
FROM logs
WHERE <time> AND <repo> AND metadata.skill_name IS NOT NULL
  AND (metadata.tool_name IN ('Skill', 'skill') OR metadata.skill_path ILIKE '%SKILL.md%')
GROUP BY 1 ORDER BY sessions DESC LIMIT 100
```

Candidate partial reads, meaning loads where the agent may have paged through the file:

```sql
SELECT metadata.skill_name AS skill, count(1) AS partial_loads
FROM logs
WHERE <time> AND <repo> AND metadata.skill_path ILIKE '%SKILL.md%'
  AND (input ILIKE '%"offset":%' OR input ILIKE '%sed -n%SKILL.md%' OR input ILIKE '%head %SKILL.md%'
       OR input ILIKE '%SKILL.md%| head%' OR input ILIKE '%SKILL.md%| tail%')
GROUP BY 1 LIMIT 100
```

`ILIKE` can't tie the paging command to the skill file. A long command that pages some other file and also reads the whole skill still matches. For any skill where partial reads would change your conclusion, select `substring(input::text, 1, 3000)` on about 20 matching loads and count the ones that really read part of `SKILL.md`. Report that share.

Join the results with the repo's own skills: `git ls-tree -r --name-only origin/main | grep '/SKILL.md$'`, with sizes from `wc -c` (~ bytes/4 tokens). Show the user a table with one row per skill:

- sessions and users
- explicit share (explicit loads / loads)
- reloads (loads / sessions)
- partial-read share, with candidates noted as an upper bound unless you sampled them
- tokens, and context spent (tokens x loads)

List the repo's skills that had no loads.

Agents that don't emit skill metadata are invisible. If a skill you know is used shows no loads, look in a session for a plain read of its `SKILL.md`.

### If this is a re-check

A skill is being re-checked if a `skill-health-<skill>` dataset exists for it, or if its last commit message names one. Split its sessions at that commit (`git log -1 --format=%cI -- <skill dir>`) and compare the numbers before and after with the one the commit message expected. If the number didn't move, or got worse, tell the user and propose reverting the change or trying again. If the skill has since grown more than 10% past its size at that commit, treat it as a target again.

## 2. Pick targets

Rank by sessions x size of the problem, and pick one to three skills:

- **Context cost**: high context spent, more than ~2 reloads per session, or a high partial-read share. The skill is too long or poorly split.
- **Triggering**: an explicit share near 100% means agents never choose the skill themselves. No loads at all makes it a candidate for deletion or a better description.
- **Execution**: any skill with real usage. Step 3 shows whether the work after loading goes wrong.

Below ~10 sessions a number is noise. Say so and don't act on it. A skill that is also product code in the repo (for example, one shipped through an MCP server) gets loads from agents editing it. Its reloads and partial reads measure development work, not use.

## 3. Diagnose from sessions

Read the skill's `SKILL.md`, then list its recent sessions:

```sql
SELECT root_span_id, created FROM logs
WHERE <time> AND <repo> AND metadata.skill_name = 'SKILL'
ORDER BY created DESC LIMIT 50
```

Read 5-10 of them one at a time, favoring sessions with several loads. A session can run past the window's edges, so widen the dates by a day here. The query linter rejects date arithmetic, so compute the dates yourself:

```sql
SELECT metrics.start AS t, span_attributes.type AS type, span_attributes.name AS name,
       metadata.skill_name AS skill, substring(error::text, 1, 200) AS err,
       CASE WHEN span_attributes.type = 'task' THEN substring(input::text, 1, 300) END AS user_msg
FROM logs
WHERE created >= 'START_MINUS_1_DAY' AND created < 'END_PLUS_1_DAY' AND root_span_id = 'ROOT_SPAN_ID'
  AND span_attributes.type IN ('task', 'tool')
ORDER BY created LIMIT 300
```

The part that matters runs from the skill load to the next `Turn` row. In it, look at the message that led to the load, what the agent did, which tool calls failed, and whether the next user message corrects the agent. Open the full conversation only when the spans don't explain what went wrong. For comparison, look at turns in the same sessions that didn't load a skill. If those fail or get corrected just as often, the skill isn't the cause.

Decide whether the skill caused each problem: a stale or wrong instruction, a missing step, an ambiguous rule, a length the agent skimmed, or a command that fails. Count only the cases the skill caused. Look for the same failure in several sessions before you change anything. For partial reads, select `substring(input::text, 1, 400)` on the loads to see which line ranges agents read. Check whether they stop before an important section.

For a triggering problem, find sessions that needed the skill but didn't load it:

```sql
SELECT root_span_id, substring(input::text, 1, 200) AS msg
FROM logs
WHERE <time> AND <repo> AND span_attributes.type = 'task' AND input ILIKE '%<words for the task>%'
LIMIT 100
```

Remove the sessions that loaded the skill. The wording of the rest shows what the description is missing.

### Capture the failures

Add each case the skill caused to the skill's dataset, creating the dataset if it doesn't exist. First check its existing rows, so you don't add the same session twice:

- `input`: the user message that led to the load (or, for a triggering miss, the message that should have triggered it), plus the repo and `git_commit_sha`
- `expected`: what the agent should have done, such as load the skill, run the correct command, follow a named rule, or produce a given output shape
- `metadata`: `skill`, `root_span_id`, `failure` (`trigger_miss`, `stale_command`, `skipped_step`, `missed_section`, `ignored_rule`), and the skill's commit at the time

Keep `expected` concrete enough for a scorer to check.

## 4. Fix

- **High context spent, reloads, or partial reads**: keep what every use needs in `SKILL.md`. Move the rest to `references/` files, each linked with a note on when to open it. Cut what the model already does without being told
- **Agents stop reading before a key section**: move it up, or into its own file
- **The same command fails after loading in several sessions**: correct the command. If you own the tool, make its error name the fix
- **Users keep correcting the same behavior**: edit the line that covers it into a concrete rule with a check or a limit
- **Agents never choose the skill**: rewrite the description around the words users actually type, or make it user-invoked only
- **No loads**: ask the owner whether to delete it, merge it into a skill that is used, or fix the description

Fix the tool instead of the skill when you can: a better error message reaches every agent, even the ones that never load the skill. Skills are shared by the team, so show the user the diff, the size before and after, and the dataset rows behind each change before you commit. In the commit message, name the dataset and the number you expect to move, for example "reloads 2.5 -> <= 1.5".

To test the change before it ships, tell the user they can run the `agent-auto-improvement` skill on the dataset. It builds scorers and an eval, and compares the old skill with the new one. Don't run it yourself. Triggering rows suit a check of whether the agent picks the skill. The other rows suit a judge of whether the output meets `expected`.

## 5. Tell the user when to run this again

This skill runs once, so end by telling the user when a re-run is worth it and what it will check. For each skill you changed, give:

- When: once the new version has about 10 sessions. Estimate a date from the skill's current sessions per week.
- What to compare: the number named in the commit message.
- The dataset name, and that they can run `agent-auto-improvement` on it if they haven't.

Also suggest a re-run whenever someone edits a skill without dataset rows behind the change, because that's how skills bloat, and about once a month otherwise. Offer to schedule it if the user's agent supports scheduled runs.
