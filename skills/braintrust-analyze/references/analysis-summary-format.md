# `ANALYSIS-SUMMARY.md` format

The running log both Braintrust skills append to — the source of truth an eval blog is
later built from. `braintrust-eval` seeds it with methodology + big learnings as the run
happens; `braintrust-analyze` adds the statistical analysis, findings, and caveats.

**Ethos:** append *as you go*; log methodology and **big learnings only** (surprises,
confounds, decisions and why) — not every number or routine step. Every finding carries
its caveat. Flag artifacts, don't hide them. Note open questions inline so they can be
filled later.

## Structure

### 1. Evaluation Card (top — the at-a-glance)
Short answers to:
- **What is evaluated?** unit of analysis + dataset + n.
- **What is the metric?** each scorer, what it means, and what it is *not*.
- **How was it scored?** judge model(s), rubric, routing (e.g. avoid self-grading).
- **Key results** — the 5-minute takeaways as a bulleted list.
- **Reliability** — which slices you trust most/least and why (visible ground truth vs
  hidden state).
- **Main limitations** — proxy vs official, small cells, contamination.
- **Best use** — what this eval should and shouldn't be used to conclude.

### 2. Methodology — "how these graphs were made (and the stats in them)"
- How rows were flattened to one tidy record per unit; any normalization.
- How rates are computed per cell (Wilson CI) and how confounds are controlled
  (coverage gates, micro vs macro, stratification, regression).
- A **stats key table**: every band/bar/dot on a plot → what it is → quick calc
  (Wilson CI, macro diamond, mix_gap, cross-task std, incremental R², box/whiskers).
- A reproducibility note (deterministic ids, cached pulls, plain-Python notebook).

### 3. Numbered key findings
Each finding = a claim, the evidence (numbers + the plot it points to), a **caveat**,
and *what it means* operationally. Group a "Some takeaways" callout under each plot.

### 4. Caveats / known limitations
Reference-quality ceilings, thin cells (n=10–15 = directional), suspiciously perfect
cells to flag, contamination/bleed, and **artifacts you deliberately did NOT fix**
(e.g. a literal scorer that dings a formatting mismatch) — flagged with the honest
takeaway, not normalized away.

### 5. Open questions / TODOs (inline is fine)
The sharp asks that make the writeup better — "which models were rate-limited so we know
which latency to trust," "exact % of failures from the scoring artifact," "a concrete
full-phrase example, not just a hyphenation." Leaving these as visible notes is the
point; they become the next analysis pass.

### 6. Provenance line (bottom)
Data source, experiment ids, join key, stats library, "no values fabricated."

## Style
Plain, honest, specific. Prefer tables for results. Every rate shows its n. Caveats sit
next to the claim they qualify, never buried at the end.
