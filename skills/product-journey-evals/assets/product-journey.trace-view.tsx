import React from "react";
import { customTraceView } from "braintrust/custom-views";
import { evidenceGroups, journeyData, parse, referencedSpans, spanName, spanType, traceRows } from "./journey-view-data";
import type { Fields } from "./journey-view-data";

const DIMENSIONS = [
  ["setup_friction", "Setup friction"], ["speed", "Task speed"],
  ["efficiency", "Tool-call efficiency"], ["errors", "Errors encountered"],
  ["doc_quality", "Docs & help"],
];
const tones = {
  blue: { ink: "#2856c5", bg: "#edf3ff", border: "#cdddfc" },
  green: { ink: "#147653", bg: "#edfaf3", border: "#bfe6d0" },
  amber: { ink: "#98600a", bg: "#fff8e7", border: "#f1db9b" },
  red: { ink: "#b73649", bg: "#fff0f2", border: "#f4c6ce" },
  gray: { ink: "#68758a", bg: "#f2f5f9", border: "#dce3ed" },
};
const panel: React.CSSProperties = { border: "1px solid #e1e7f0", borderRadius: 14, padding: 22, background: "#fff", minWidth: 0 };
const linkButton: React.CSSProperties = { border: 0, borderRadius: 5, padding: "4px 8px", background: "#edf3ff", color: "#2856c5", cursor: "pointer", fontSize: 12 };
const labels: Record<string, string> = {
  NONE: "Smooth setup", MINOR: "Minor setup friction", HIGH: "Difficult setup", BLOCKED: "Setup blocked",
  NO_ERRORS: "No errors found", RECOVERED: "Recovered from errors", BLOCKING: "Unresolved errors",
  AVAILABLE_USEFUL: "Helpful and accessible", AVAILABLE_GAPS: "Gaps in guidance", HARD_TO_FIND: "Difficult to find", MISSING_OR_UNUSABLE: "Missing or unusable",
};
function safeUrl(value: string) { try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) ? value : undefined; } catch { return undefined; } }
function scoreTone(score: number) { return score >= .8 ? tones.green : score >= .5 ? tones.amber : tones.red; }
function badge(text: string, tone = tones.gray) {
  return <span style={{ display: "inline-flex", alignItems: "center", borderRadius: 20, padding: "5px 10px", fontSize: 12, fontWeight: 600, background: tone.bg, color: tone.ink }}>{text}</span>;
}

export default customTraceView(
  { name: "Product journey review", slug: "product-journey-review" },
  ({ trace, span, selectSpan }) => {
    const [fields, setFields] = React.useState<Fields>({});
    const [loading, setLoading] = React.useState(true);
    const [error, setError] = React.useState("");
    const [retry, setRetry] = React.useState(0);
    const [focusedEvidence, setFocusedEvidence] = React.useState<number | null>(null);
    const root = span.root_span_id || trace.rootSpanId;
    const key = `${root}:${trace.spanOrder.join(",")}`;

    React.useEffect(() => {
      let cancelled = false;
      setFields({}); setLoading(true); setError("");
      const rows = traceRows(trace, root);
      const ids = rows.filter(row => ["eval", "score"].includes(spanType(row))
        || row.data.span_attributes?.purpose === "scorer"
        || (spanType(row) === "task" && spanName(row) === "task")).map(row => row.span_id);
      async function load() {
        const data: Fields = {};
        for (let i = 0; i < ids.length; i += 50) {
          Object.assign(data, await trace.fetchSpanFields(ids.slice(i, i + 50), ["input", "output", "metadata"]));
        }
        const tools = rows.filter(row => spanType(row) === "tool").map(row => row.span_id);
        for (let i = 0; i < tools.length; i += 50) {
          Object.assign(data, await trace.fetchSpanFields(tools.slice(i, i + 50), ["metadata"]));
        }
        if (!cancelled) { setFields(data); setLoading(false); }
      }
      load().catch(err => { if (!cancelled) { setError(String(err.message || err)); setLoading(false); } });
      return () => { cancelled = true; };
    }, [key, retry]);

    const rows = traceRows(trace, root, { ...fields, [span.span_id]: { ...span.data, ...fields[span.span_id] } });
    const data = journeyData(rows);
    const journey = parse(data.record.journey) || {};
    const caseData = parse(data.record.case) || parse(data.task?.data.input) || {};
    const groups = evidenceGroups(journey.evidence || []);
    const criteria = journey.criteria || [];
    const complete = data.scores.task_completed?.metadata?.choice;
    const allMet = criteria.length > 0 && criteria.every((c: any) => c.status === "met");
    const outcome = complete === "COMPLETE" ? "Completed" : complete === "PARTIAL" ? "Partially completed" : complete === "INCOMPLETE" ? "Incomplete" : allMet ? "All criteria met" : "Outcome pending";
    const outcomeTone = complete === "COMPLETE" ? tones.green : complete === "INCOMPLETE" ? tones.red : complete === "PARTIAL" ? tones.amber : allMet ? tones.green : tones.gray;
    const summary = String(journey.summary || data.record.error || "");
    const sentences = summary.split(/(?<=[.!?])\s+(?=[A-Z])/);
    const lead = sentences.slice(0, 2).join(" ");
    const remaining = sentences.slice(2);
    const unavailable = DIMENSIONS.map(([name, label]) => ({ label, assertion: data.scores[name] }))
      .filter(({ assertion }) => assertion?.metadata?.choice === "UNSCORABLE");
    React.useEffect(() => {
      if (focusedEvidence !== null) {
        document.getElementById(`journey-evidence-${focusedEvidence}`)?.scrollIntoView({ behavior: "instant", block: "center" });
      }
    }, [focusedEvidence]);
    function references(text: string) {
      return referencedSpans(text, rows).map(row => <button key={row.span_id} style={linkButton} onClick={() => selectSpan?.(row.span_id)}>↗ {spanName(row)}</button>);
    }
    function showEvidence(index: number) {
      setFocusedEvidence(index);
    }

    if (loading) return <div style={{ padding: 24, color: "#68758a" }}>Loading journey review…</div>;
    if (error) return <div style={{ ...panel, color: tones.red.ink }} role="alert">Could not load review: {error} <button onClick={() => setRetry(n => n + 1)}>Try again</button></div>;
    if (!data.task) return <div style={{ padding: 24 }}>Open a product journey eval case to see its review.</div>;

    return <main style={{ fontFamily: "Inter, system-ui, sans-serif", fontSize: 14, lineHeight: 1.6, color: "#26334d", background: "#f7f9fc", padding: 22, display: "grid", gap: 18, overflowWrap: "anywhere" }}>
      <header style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <div><div style={{ fontSize: 11, letterSpacing: "0.12em", color: "#68758a", fontWeight: 700, textTransform: "uppercase" }}>Product journey review</div>
          <h2 style={{ fontSize: 21, margin: "4px 0 0", color: "#17243b" }}>{String(caseData.id || "Journey").replace(/[-_]/g, " ")}</h2></div>
        {badge(outcome, outcomeTone)}
      </header>
      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
        {DIMENSIONS.map(([name, label]) => {
          const assertion = data.scores[name];
          const metadata = assertion?.metadata || {};
          const measured = name === "speed" ? data.seconds : name === "efficiency" ? data.tools.length : null;
          const scored = typeof assertion?.score === "number";
          if (!scored && measured === null) return null;
          const tone = scored ? scoreTone(assertion.score) : tones.blue;
          const rationale = metadata.rationale || metadata.reason || "";
          const value = name === "speed" ? (measured === null ? `${Math.round(assertion.score * 100)}%` : `${measured.toFixed(1)}s`) : name === "efficiency" ? String(measured) : `${Math.round(assertion.score * 100)}%`;
          return <article key={name} style={{ ...panel, padding: 16, background: tone.bg, borderColor: tone.border }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: tone.ink }}>{label}</div>
            <div style={{ fontSize: 30, fontWeight: 700, letterSpacing: "-0.04em", color: tone.ink, marginTop: 6 }}>{value}</div>
            <div style={{ fontSize: 12, color: tone.ink }}>{name === "speed" ? "Task duration" : name === "efficiency" ? "Tool calls · retries included" : labels[metadata.choice] || "Assessment"}</div>
            {rationale && <details style={{ marginTop: 12, fontSize: 12 }}><summary style={{ cursor: "pointer", color: tone.ink }}>Why this score</summary><p style={{ whiteSpace: "pre-wrap", lineHeight: 1.7 }}>{rationale}</p><div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>{references(rationale)}
              {assertion.source && <button style={linkButton} onClick={() => selectSpan?.(assertion.source)}>↗ Scorer</button>}</div></details>}
          </article>;
        })}
      </section>
      <section style={panel}>
        <h3 style={{ margin: "0 0 12px", fontSize: 16 }}>Outcome</h3>
        {lead && <p style={{ margin: "0 0 16px", maxWidth: "80ch", color: "#52617a" }}>{lead}</p>}
        {remaining.length > 0 && <details style={{ marginBottom: 18 }}><summary style={{ cursor: "pointer", color: "#2856c5", fontSize: 12 }}>Read the full account</summary>
          <div style={{ maxWidth: "80ch", color: "#52617a" }}>{remaining.map((sentence, index) => <p key={index}>{sentence}</p>)}</div></details>}
        <div style={{ display: "grid", gap: 0 }}>{criteria.map((criterion: any) => {
          const description = (caseData.criteria || []).find((c: any) => c.id === criterion.id)?.description || criterion.id.replace(/[-_]/g, " ");
          const tone = criterion.status === "met" ? tones.green : criterion.status === "unmet" ? tones.red : tones.gray;
          return <div key={criterion.id} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "12px 0", borderTop: "1px solid #edf0f5" }}>
            <span style={{ color: tone.ink, background: tone.bg, borderRadius: "50%", width: 23, height: 23, flexShrink: 0, textAlign: "center", fontWeight: 700 }}>{criterion.status === "met" ? "✓" : criterion.status === "unmet" ? "!" : "?"}</span>
            <div style={{ flex: 1 }}>{description}</div>
            {criterion.evidence?.length > 0 && <button style={linkButton} onClick={() => showEvidence(criterion.evidence[0])}>{criterion.evidence.length} reference{criterion.evidence.length === 1 ? "" : "s"} ↓</button>}
          </div>;
        })}</div>
        <div style={{ display: "flex", gap: 6, marginTop: 12, flexWrap: "wrap" }}>
          {!complete && allMet && badge("Agent-reported outcome")}
          {data.scores.setup_friction?.metadata?.choice === "NOT_REQUIRED" && badge("No setup required")}
          {data.scores.doc_quality?.metadata?.choice === "NOT_NEEDED" && badge("No docs needed")}
        </div>
      </section>
      {[ ["Blockers", journey.blockers, tones.red], ["Friction encountered", journey.friction, tones.amber] ].map(([title, items, color]) =>
        Array.isArray(items) && items.length > 0 ? <section key={String(title)} style={{ ...panel, borderLeft: `4px solid ${(color as typeof tones.red).ink}` }}><h3 style={{ marginTop: 0, fontSize: 16 }}>{String(title)}</h3>
          {items.map((item: any, index: number) => <div key={index} style={{ marginTop: 14 }}>{badge(item.category, color as typeof tones.red)}<p style={{ fontWeight: 600 }}>{item.description}</p><div style={{ color: "#68758a", fontSize: 13 }}>Impact: {item.impact}<br />Recovery: {item.recovery}</div></div>)}</section> : null)}
      {groups.length > 0 && <section style={panel}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}><h3 style={{ margin: 0, fontSize: 16 }}>Journey evidence</h3>{badge(`${groups.length} source${groups.length === 1 ? "" : "s"}`, tones.blue)}</div>
        <p style={{ margin: "5px 0 18px", color: "#68758a", fontSize: 12 }}>Observations grouped by source. Expand to inspect supporting text.</p>
        <div style={{ display: "grid", gap: 10 }}>{groups.map(group =>
          <details key={group.url} open={focusedEvidence !== null && group.items.some(item => item.index === focusedEvidence) ? true : undefined} style={{ border: "1px solid #e1e7f0", borderRadius: 10, background: "#fbfcff" }}>
            <summary style={{ cursor: "pointer", padding: "13px 16px" }}><strong style={{ color: "#2856c5" }}>{group.title}</strong><span style={{ color: "#68758a", fontSize: 12, marginLeft: 10 }}>{group.host} · {group.items.length} observation{group.items.length === 1 ? "" : "s"}</span></summary>
            <div style={{ padding: "0 16px 14px" }}><a href={safeUrl(group.url)} target="_blank" rel="noopener noreferrer" style={{ color: "#2856c5", fontSize: 12 }}>Open source ↗</a>
              {group.items.map(item => <div id={`journey-evidence-${item.index}`} key={item.index} style={{ padding: "14px 0 4px", borderTop: "1px solid #e8edf5", marginTop: 12 }}>
                <div style={{ display: "flex", gap: 10 }}><span style={{ color: "#8792a5", fontSize: 11, flexShrink: 0 }}>#{item.index + 1}</span><div>{item.observation}
                  {item.quote && <details style={{ marginTop: 8 }}><summary style={{ cursor: "pointer", fontSize: 12, color: "#68758a" }}>Supporting text</summary><blockquote style={{ margin: "8px 0", padding: "10px 14px", borderLeft: "3px solid #9fbaf2", background: "#edf3ff", fontFamily: "ui-monospace, monospace", fontSize: 12, whiteSpace: "pre-wrap" }}>{item.quote}</blockquote></details>}
                </div></div>
              </div>)}
            </div>
          </details>)}</div>
      </section>}
      {unavailable.length > 0 && <details style={{ color: "#68758a", fontSize: 12 }}><summary style={{ cursor: "pointer" }}>{unavailable.length} assessment{unavailable.length === 1 ? "" : "s"} could not be completed</summary>{unavailable.map(({ label, assertion }) => <p key={label}>{label}: {assertion.metadata.reason || "Insufficient evidence"}</p>)}</details>}
    </main>;
  },
);
