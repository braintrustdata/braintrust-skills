# Statistics toolkit

Match the statistic to the question. Compute with `numpy` + `scipy`
(`ttest_rel`, `wilcoxon`, `spearmanr`) and `statsmodels` for regression. **Never
fabricate a number** — every value traces back to the cached pull.

## Which stat for which question

| Question | Use |
|---|---|
| How spread out is a score? | mean, sample std (`ddof=1`), 95% CI of the mean |
| Is a success/pass *rate* trustworthy at this n? | **Wilson 95% CI** |
| Did variant B beat variant A? | **paired** t-test + Wilcoxon on the per-case diff |
| Does the LLM judge track the real signal? | Spearman rho vs deterministic scorers |
| Which knob (model/harness/…) explains success? | incremental R² / η² from a regression |
| Is a config *consistent* across tasks? | cross-task std of its per-slice rates |

## Dispersion — mean ± CI of the mean

```python
import numpy as np
mean = x.mean()
std  = x.std(ddof=1)                 # sample std
ci   = 1.96 * std / np.sqrt(len(x))  # 95% CI half-width of the MEAN
# report: mean, std, [mean-ci, mean+ci]
```
Bimodal scores (many 1.0s + a hard tail) give a large std — that's expected, and it's
why paired tests below are far more powerful than these marginal CIs.

## Rates — Wilson 95% CI (not naive ±)

For a binary rate `p = k/n`, the naive `±1.96·√(p(1-p)/n)` goes out of [0,1] and lies at
small n. Use Wilson (`z=1.96`):

```
center = (p + z²/2n) / (1 + z²/n)
half   = (z / (1 + z²/n)) · √( p(1-p)/n + z²/4n² )
```
`scipy.stats` has it via `proportion_confint(k, n, method="wilson")` (statsmodels). The
**Wilson lower bound** (`center − half`) is a good conservative "at least this much" sort
key.

## Lift — pair, don't average two means

To test whether B beats A, **pair by case id** (intersection of the two runs'
`conversation_id`/example ids) and test the per-case difference `Δ = B − A`:

```python
from scipy.stats import ttest_rel, wilcoxon
a, b = paired_arrays(A, B)          # aligned by case id
delta = (b - a).mean()
ci    = 1.96 * (b - a).std(ddof=1) / np.sqrt(len(a))
t_p   = ttest_rel(b, a).pvalue      # parametric
w_p   = wilcoxon(b, a).pvalue       # non-parametric backup
# significant @0.05 if p < 0.05 AND the CI of Δ excludes 0
```
Report `Δ`, its 95% CI, and both p-values. **A point estimate is not significance:** a
real +0.11 gain at n=30 can still have p=0.10 with a CI that includes 0 — say so rather
than presenting it as proven. This is the same trap as concluding from an n=5 smoke;
verify at full n.

## Judge validation — Spearman

```python
from scipy.stats import spearmanr
rho, p = spearmanr(judge_scores, deterministic_scores)
```
A positive, moderate, significant rho (e.g. 0.4–0.5, p≪0.001) means the judge is
measuring the same underlying signal, not drifting. Also cross-tab judge verdict ×
similarity bin and check the mass sits on the diagonal.

## Confound control — micro vs macro, coverage, regression

- **micro (pooled)** rate = `k/n` over all of a config's rows. **macro (balanced)** rate
  = mean of the per-slice rates (equal weight per slice). `mix_gap = micro − macro`
  exposes a config flattered by an easy task mix (**Simpson's paradox**).
- **Coverage gates:** drop cells under a threshold (n≥5/cell, n≥10/config) and report
  what was dropped.
- **cross-task std** = std of a config's per-slice rates — low = dependable, high =
  gambler (great on average, one slice it falls apart).
- **Regression** for "which knob matters": fit a linear-probability model
  `success ~ C(a) + C(b) + C(c)` with HC1 robust SEs (`statsmodels.formula.api.ols`,
  `.fit(cov_type="HC1")`). **Incremental R²** = `R²_full − R²_without_that_factor` is the
  coverage-adjusted "how much does this knob explain on top of the others." Report it
  next to a plain one-way breakdown, which usually *inflates* the gap.

## Box plots
Box = IQR (25th–75th), line = median, whiskers = 1.5×IQR, outliers hidden. Good for
per-run signals (tokens, latency) where you want the distribution, not just the mean.

## Reporting rules
- Show uncertainty (CI or p) beside every comparison — never a bare delta.
- Round scores to 3 decimals, p-values to 3 significant figures.
- State n (and `ok = roots − errored`) next to every rate.
