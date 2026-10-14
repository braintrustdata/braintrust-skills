---
name: braintrust-patterns-slack-digest
description: Build and deliver the daily Patterns digest as one Slack message. Use when a scheduled Patterns automation has a Slack action to deliver after the analysis. Do not use for pattern investigation itself or for other automations' Slack messages.
---

# Patterns Slack digest

Deliver the run's Patterns digest as one Slack mrkdwn message. Build it with code in your sandbox: selection, ranking and rates are deterministic, so compute them rather than writing them by hand.

## What goes in the digest

Include only Patterns whose final status is active at the end of this run. Never mention inactive Patterns, including ones that became inactive during this run.

- **New**: created during this run, or changed from inactive to active during this run.
- **Existing**: active before this run and still active.
- **Frequency**: the Pattern's saved `evidence.frequency.snapshot` counts over the window it was measured. When the Pattern has a `population_filter` and its snapshot has `population_affected_trace_count`, use affected traces out of similar traces (`population_affected_trace_count` of `population_trace_count`); otherwise use affected traces out of all traces (`affected_trace_count` of `total_trace_count`). Patterns without a snapshot have no frequency.

**Ranking**: rank Patterns by severity first, from high to informational, with Patterns without a severity last. Within a severity, rank by the lower bound of the 95% Wilson score interval of their frequency, so a rate backed by many traces outranks a similar or higher rate backed by a handful. Patterns measured over fewer than 20 traces rank after every Pattern with enough traces, and Patterns without a frequency rank last within their severity. The script does this.

**Shown patterns**: the 2 top-ranked New Patterns plus the 1 top-ranked Existing Pattern, displayed together in rank order. If a group has fewer Patterns, show what it has; do not backfill from the other group.

**Pattern rows**: each shown Pattern has two lines. The linked title, prefixed with `[New] ` inside the link for New Patterns. Then a line with the Pattern's severity as a circle emoji and capitalized label (`:red_circle: *High*`, `:large_yellow_circle: *Medium*`, `:white_circle: *Low*`, `:large_blue_circle: *Informational*`), followed by the frequency and its measured window as numeric month/day dates, for example `:red_circle: *High*  ·  10.4%  ·  156 of 1,500 similar traces · 9/3 - 10/3`, or just `traces` when the Pattern uses all-traces counts. Leave out severity when the Pattern has none.

**More patterns**: do not list the other active Patterns. End the message with `+N more · View all in Braintrust`, linking to the Patterns page, where N is the number of active Patterns not shown.

If no Patterns are active, deliver only the message "No current pattern outcomes."

## Data to gather

After your last `new_pattern` or `update_pattern` call, call `search_patterns` with `status: "active"` and `include_evidence: true`, retrieving all pages. These results are the final active set: use each Pattern's name, URL, `severity`, and `evidence.frequency` from them, not from results retrieved before your updates. Mark a Pattern as New only if this run created it with `new_pattern` or changed it from inactive to active with `update_pattern`.

Write **highlights** about the concrete problem and impact of the active Patterns, or a meaningful change supported by this run. Use one short line per takeaway, with bullets for distinct takeaways. Do not include counts of findings created, updated, or refreshed; summaries of the run's work; investigation methods; sampling or coverage limitations; or standalone caveats about recurrence or frequency measurement. Keep necessary qualifications with the specific claim they qualify and put methodology in evidence. State takeaways directly without rhetorical "X, not Y" framing. Avoid restated Pattern descriptions, speculation, or claims this run did not find. If there is no useful takeaway, pass an empty string to omit Highlights. Each distinct takeaway must link directly to the active Pattern that supports it, using Slack syntax <pattern_url|takeaway text> and its exact URL from the final search_patterns results. A highlighted Pattern may be outside the displayed rows; its link must identify the supporting record. Omit claims without a validated supporting Pattern. Put each linked takeaway on its own line.

Do not query traces to build the digest; use the frequency already stored on each Pattern.

## Build the message with code

Write the input as JSON and run this script unchanged in your sandbox; adjust only the input. It prints the finished message. It shows a rate only when measured over at least 20 traces, using whole percentages below 300, and writes counts with comma separators.

```python
import json
import re
import sys
from datetime import datetime

MIN_TOTAL = 20
SEVERITY_ORDER = {"high": 0, "medium": 1, "low": 2, "informational": 3}
SEVERITY_EMOJI = {
    "high": ":red_circle:",
    "medium": ":large_yellow_circle:",
    "low": ":white_circle:",
    "informational": ":large_blue_circle:",
}


def esc(text):
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def render_highlights(text, patterns):
    allowed_urls = {p["url"] for p in patterns}
    rendered = []
    for line in text.splitlines():
        if not line.strip():
            continue
        urls = re.findall(r"<(https?://[^<>|\s]+)\|", line)
        if any(url not in allowed_urls for url in urls):
            raise ValueError("Highlight links must use active Pattern URLs from the final search")
        link = re.fullmatch(r"(\s*(?:[•*-]\s+)?)<(https?://[^<>|\s]+)\|(.+)>\s*", line)
        if not link or len(urls) != 1:
            raise ValueError("Every highlight must link to its supporting active Pattern")
        prefix, url, label = link.groups()
        rendered.append(f"{esc(prefix)}<{url}|{esc(label)}>")
    return "\n".join(rendered)


def wilson_lower(affected, total, z=1.96):
    phat = affected / total
    denom = 1 + z * z / total
    center = phat + z * z / (2 * total)
    margin = z * ((phat * (1 - phat) + z * z / (4 * total)) / total) ** 0.5
    return (center - margin) / denom


def count(n):
    return f"{n:,}"


def day(value):
    date = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return f"{date.month}/{date.day}"


def measured(p):
    frequency = p.get("frequency") or {}
    snapshot = frequency.get("snapshot")
    if not snapshot:
        return None
    if frequency.get("population_filter") and "population_affected_trace_count" in snapshot:
        return (
            snapshot["population_affected_trace_count"],
            snapshot["population_trace_count"],
            "similar traces",
        )
    return snapshot["affected_trace_count"], snapshot["total_trace_count"], "traces"


def metrics(p):
    counts = measured(p)
    if counts is None:
        return "Not measured"
    affected, total, scope = counts
    window = p["frequency"]["snapshot"]["time_window"]
    period = f"{day(window['from'])} - {day(window['to'])}"
    if total < MIN_TOTAL:
        return f"{count(affected)} of {count(total)} {scope} · {period}"
    rate = 100 * affected / total
    rate = f"{rate:.0f}%" if total < 300 else f"{rate:.1f}%"
    return f"{rate}  ·  {count(affected)} of {count(total)} {scope} · {period}"


def row(p):
    title = f"[New] {p['title']}" if p["is_new"] else p["title"]
    severity = p.get("severity")
    labels = [f"{SEVERITY_EMOJI[severity]} *{severity.capitalize()}*"] if severity in SEVERITY_EMOJI else []
    return f"*<{p['url']}|{esc(title)}>*\n" + "  ·  ".join([*labels, metrics(p)])


def freq_key(p):
    counts = measured(p)
    if counts is None:
        return (2, 0)
    affected, total, _scope = counts
    return (1 if total < MIN_TOTAL else 0, -wilson_lower(affected, total))


def rank_key(p):
    return (SEVERITY_ORDER.get(p.get("severity"), len(SEVERITY_ORDER)), *freq_key(p))


data = json.load(open(sys.argv[1]))
patterns = data["patterns"]
if not patterns:
    print("No current pattern outcomes.")
    sys.exit(0)
new = sorted([p for p in patterns if p["is_new"]], key=rank_key)
existing = sorted([p for p in patterns if not p["is_new"]], key=rank_key)
shown = sorted(new[:2] + existing[:1], key=rank_key)
hidden = len(patterns) - len(shown)

highlights = render_highlights(data.get("highlights", "").strip(), patterns)
parts = [
    f"*Pattern digest* · {esc(data['project_name'])} · {len(new)} new, {len(existing)} existing · <{data['patterns_url']}|View all>",
    *([f"*Highlights*\n{highlights}"] if highlights else []),
    *(row(p) for p in shown),
]
if hidden:
    parts.append(f"+{hidden} more · <{data['patterns_url']}|View all in Braintrust>")
print("\n\n".join(parts))
```

Input shape:

```json
{
  "project_name": "support-agent",
  "patterns_url": "https://<app>/app/<org>/p/<project>/patterns",
  "highlights": "<pattern_url|takeaway text> (one linked takeaway per line, or an empty string)",
  "patterns": [
    {
      "title": "<pattern name>",
      "url": "<pattern URL>",
      "is_new": true,
      "severity": "high",
      "frequency": "<the Pattern's evidence.frequency, unchanged>"
    }
  ]
}
```

`patterns_url` is any Pattern URL with its final path segment removed. Omit `severity` when the Pattern has none. Pass `frequency` as the Pattern's `evidence.frequency` object exactly as `search_patterns` returned it, and omit it when the Pattern has none.

## Deliver

Call the delivery tool once for each Slack action that uses the digest, with `message` set to exactly what the script printed. Do not add other text.
