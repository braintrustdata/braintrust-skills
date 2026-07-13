# Turning ANALYSIS-SUMMARY.md into a blog

Applies when the user wants the eval written up for readers. Match the
publication's or team's writing voice and brand/style guidelines. This file adds
the eval-specific rules on top.

## Structural template (distilled from Braintrust research-blog exemplars)

Pattern extracted from: [us-belgium-eval](https://www.braintrust.dev/blog/us-belgium-eval),
[world-cup-knowledge-graphs](https://www.braintrust.dev/blog/world-cup-knowledge-graphs),
[glm-52-vs-opus-48-long-context-retrieval](https://www.braintrust.dev/blog/glm-52-vs-opus-48-long-context-retrieval),
[hf-agent-traces](https://www.braintrust.dev/blog/hf-agent-traces),
[test-agent-cost-efficiency](https://www.braintrust.dev/blog/test-agent-cost-efficiency).

1. **Title: descriptive, not clickbait** — name the things compared and the
   task ("GLM 5.2 vs Opus 4.8 on long-context retrieval"), sentence case.
2. **Open with the problem/thesis in 1–3 sentences** — no personal windup.
   ("For an LLM to be useful for coding agents, it must accurately retrieve…")
   A personal beat may follow, but the problem leads.
3. **Main-takeaways block immediately after the open** — 5–8 bullets of actual
   findings with numbers. Readers get the verdict before the story.
4. **Functional sentence-case headers**: "What we tested", "How we measure it",
   "What we found", "Where quality breaks down", "What this means in
   practice". Short and scannable, not witty.
5. **Methodology with concrete scale numbers** (runs, configs, dollars) and a
   **scorer reference table** with plain-language descriptions. **Include the
   LLM-judge prompt verbatim** — the exemplars publish theirs.
6. **Results in mixed formats**: tables for headline numbers, charts with CIs,
   prose that interprets rather than repeats. Costs stated exactly ("$0.10 per
   run"), never "roughly".
7. **A dedicated Caveats section**, blunt ("suspiciously perfect", "n=10–15 in
   some cells") — never smoothed into the prose.
8. **Close forward-looking**: what this setup enables next, what to run next —
   not a philosophical reflection. A light Braintrust CTA may come last.
9. **Length**: 1,200–6,000 words; ~2,000–3,000 is the sweet spot for a
   single-experiment story.
10. **Keep "what went wrong" story sections, but compressed.** Confound
    catches and debugging detours earn their place — they're often the most
    reusable content — but they must not overtake the findings. Budget
    ~150–200 words per story section: verdict first, at most one quoted
    trace/message, the mechanism in one or two sentences, and a link to the
    full forensics in `ANALYSIS-SUMMARY.md` for readers who want the blow-by-
    blow. If the post spends more words on the detour than the results,
    rebalance.

## The jargon rule (the big one)

Write for a smart reader who has never touched these tools. **Every technical
term, library, model, or metric gets a one-sentence plain-English explanation
plus a link on its first mention.** Never let a name do the work of an
explanation.

Examples of the required treatment:
- *CLIP cosine similarity* → "CLIP is a model from OpenAI that maps images and
  text into the same numerical space, so two images can be compared by how
  close their vectors point — that closeness (cosine similarity) becomes our
  0–1 visual score." (link: OpenAI CLIP repo/paper)
- *ViT-B/32* → "the specific CLIP variant we used — a mid-sized Vision
  Transformer that chops each image into 32-pixel patches."
- *BeautifulSoup* → "a Python library for pulling text and structure out of
  HTML." (link: docs)
- *Playwright / headless browser* → "Playwright drives a real Chrome browser
  with no visible window (a 'headless' browser), letting us render each
  generated page and screenshot it programmatically." (link: playwright.dev)

Checklist pass before delivering a draft: scan for any capitalized tool name,
model id, or metric that a PM couldn't define after reading the sentence it
appears in — fix each one. Prefer an analogy over precision when both would fit
in one sentence.

## Structure that carries over from the log

- Methodology (what varied, what was fixed) → early in the post.
- The dataset **provenance blurb** (who built it, downloads/stars, paper) →
  include; readers should know why the benchmark is credible.
- Confounds/caveats found during the run → keep them; honesty is the voice.
- Numbers come from the experiment results, never rounded from memory —
  re-check against Braintrust before publishing.
