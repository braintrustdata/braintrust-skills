---
name: braintrust-analyze
description: >-
  Pull, analyze, and visualize Braintrust experiment/log results — compute the
  right statistics (CIs, significance, confounds), plot with Braintrust styling,
  and write findings into a running ANALYSIS-SUMMARY.md. Use when the user wants to
  analyze eval results, compare experiments, compute significance / std / CIs, plot
  scores, or turn experiment runs into insights or a blog.
---

# Braintrust Analyze

Turn finished Braintrust experiments/logs into trustworthy insight: pull the rows,
compute statistics that survive scrutiny, plot them in Braintrust style, and log the
analysis into a running `ANALYSIS-SUMMARY.md` for the blog.

Pairs with **`braintrust-eval`** (which runs the experiments and starts the summary
file). This skill is the deeper-analysis half. The discipline that matters most:
**don't rank on raw averages** — control confounds and show uncertainty first.

## When to use / not
- **Use** to analyze/compare experiments that already ran, compute stats, make plots,
  or write up results.
- **Running or scoring a new eval** → `braintrust-eval`.

## Phase 1 — Preflight
Select the org's key exactly as `braintrust-eval` does (see `references/bt-auth.md`);
never re-prompt for the raw key. Confirm which project and which experiments/logs to
analyze.

## Phase 2 — Pull the results, then cache them
- Pull rows via **BTQL, cursor-paginated**, with retry/backoff. The fetch **caps at
  1000 rows/page** — paginate or you'll silently summarize a partial set.
- **Dump everything to one JSON cache and analyze off the cache** — re-pulling many
  experiments is slow and 429-prone. (`references/results-pull.md`)
- Prefer the `bt` CLI / SDK / REST over the MCP server.

## Phase 3 — Compute the *right* statistic (don't eyeball averages)

Match the stat to the question (`references/stats.md`):
- **Dispersion:** mean, sample std (`ddof=1`), 95% CI of the mean (`±1.96·std/√n`).
- **Rates / binary scores:** **Wilson 95% CI** (stays in [0,1], widens for small n) —
  not a naive `±`.
- **Lift (variant A vs B):** **pair by case id**, then paired t-test + Wilcoxon;
  report Δ, its 95% CI, and p. A point estimate is **not** significance — an n=5 smoke
  can mislead; confirm at full n.
- **Judge validation:** Spearman rho of the judge vs the deterministic scorers.
- **Explained variance:** η² / incremental R² from a linear-probability regression
  when you need "which knob matters most."

## Phase 4 — Control confounds BEFORE ranking
- **Coverage gates:** drop thin cells (e.g. n≥5/cell, n≥10/config) and **say what you
  dropped** — never truncate silently.
- **Stratify — never pool blindly** (Simpson's paradox). Compute **micro (pooled) AND
  macro (balanced)** rates; a big gap means an easy task mix is flattering a config.
- **Compare only within shared slices**; when a confound is unobserved, say so out loud.
- **Verify `ok = roots − errored`** before trusting any aggregate (a "completed" run
  can be mostly errored).

## Phase 5 — Plot (Braintrust styling)
- **Invoke the `braintrust-graph-styles` skill** for brand colors/typography/spacing —
  don't hand-roll styling or copy hex codes.
- **One plot answers one question.** The caption says what to read *and* what's fair to
  compare. Show CIs/error bars. Grey out thin cells so small-n reads as uncertain.

## Phase 6 — Write into `ANALYSIS-SUMMARY.md`
Append to the same running file `braintrust-eval` started (`references/analysis-summary-format.md`):
- **Methodology** — "how these graphs were made + the stats in them," including a stats
  key so a reader knows what every band/bar/dot means.
- **Numbered key findings** — each with its number, its **caveat**, and *what it means*.
- **Caveats / limitations** — reference-quality ceilings, thin cells, and any scoring
  **artifact you chose NOT to fix** (flag it, don't smooth it away).
- **Open questions / TODOs** — note what's missing (a table, an exact %, a concrete
  example) so it can be filled. Asking sharp, specific questions is part of the job.
- A **provenance line** — data source, join key, "no values fabricated."

## Overridable defaults (say so to override)
- Cache pulls; analyze off the cache.
- Stratify before ranking; show **micro AND macro**.
- Show uncertainty (CI / p) — never a bare point estimate for a comparison.
- Flag artifacts and thin cells rather than smoothing them away.
- Call `braintrust-graph-styles` for every plot.

## References
- `references/stats.md` — the statistical toolkit (formulas + which stat for which question)
- `references/analysis-summary-format.md` — the running-log structure
- `references/results-pull.md` — BTQL pagination + disk cache + retry/backoff
- `references/bt-setup.md`, `references/bt-auth.md` — install + org-scoped keys
