// Derive the view from Braintrust spans; no duplicate telemetry or browser API keys.
export type Span = {
  id: string;
  span_id: string;
  root_span_id: string;
  span_parents?: string[];
  parent_span_id?: string | null;
  data: Record<string, any>;
};
export type Fields = Record<string, Record<string, any>>;

export function parse(value: any): any {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { return value; }
}

export function spanType(span: Span) { return span.data.span_attributes?.type; }
export function spanName(span: Span) { return span.data.span_attributes?.name || span.span_id; }

export function traceRows(trace: { spanOrder: string[]; spans: Record<string, Span> }, root: string, fields: Fields = {}) {
  return trace.spanOrder.map(id => trace.spans[id]).filter(Boolean)
    .filter(row => row.root_span_id === root || row.span_id === root)
    .map(row => ({ ...row, data: { ...row.data, ...fields[row.span_id] } }));
}

export function descendants(rows: Span[], parent: string) {
  const ids = new Set([parent]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows) {
      const parents = row.span_parents || (row.parent_span_id ? [row.parent_span_id] : []);
      if (!ids.has(row.span_id) && parents.some(id => ids.has(id))) {
        ids.add(row.span_id); changed = true;
      }
    }
  }
  return rows.filter(row => ids.has(row.span_id));
}

export function duration(row?: Span): number | null {
  const metrics = row?.data.metrics || {};
  if (Number.isFinite(metrics.duration)) return metrics.duration;
  if (Number.isFinite(metrics.start) && Number.isFinite(metrics.end)) return Math.max(0, metrics.end - metrics.start);
  return null;
}

export function scoreEntries(value: any): any[] {
  value = parse(value);
  if (Array.isArray(value)) return value.filter(item => item && typeof item.name === "string");
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).map(([name, result]: [string, any]) =>
    typeof result === "number" || result === null ? { name, score: result } : { ...result, name });
}

export function journeyData(rows: Span[]) {
  const task = rows.find(row => spanType(row) === "task" && spanName(row) === "task" && parse(row.data.output)?.case)
    || rows.find(row => spanType(row) === "task" && spanName(row) === "task");
  const root = rows.find(row => spanType(row) === "eval");
  const record = parse(task?.data.output) || parse(root?.data.output) || {};
  const agentRows = task ? descendants(rows, task.span_id).filter(row => row.span_id !== task.span_id) : [];
  const tools = agentRows.filter(row => spanType(row) === "tool" && spanName(row) !== "StructuredOutput");
  const scores: Record<string, any> = {};
  for (const [name, score] of Object.entries(root?.data.scores || {})) scores[name] = { name, score };
  for (const row of rows.filter(row => spanType(row) === "score" || row.data.span_attributes?.purpose === "scorer")) {
    for (const entry of scoreEntries(row.data.output)) scores[entry.name] = {
      ...entry, metadata: { ...row.data.metadata?.[entry.name], ...entry.metadata }, source: row.span_id,
    };
    for (const [name, score] of Object.entries(row.data.scores || {})) {
      scores[name] = { ...scores[name], name, score, source: row.span_id };
    }
  }
  return { task, record, tools, agentRows, scores,
    seconds: duration(task), errors: agentRows.filter(row => Boolean(row.data.error)) };
}

export function referencedSpans(text: string, rows: Span[]) {
  return rows.filter(row => text.includes(row.span_id) || (row.id && text.includes(row.id))
    || (row.data.metadata?.tool_call_id && text.includes(row.data.metadata.tool_call_id)));
}

export function evidenceGroups(evidence: any[]) {
  const groups = new Map<string, { url: string; title: string; host: string; items: any[] }>();
  evidence.forEach((item, index) => {
    const url = String(item.url || "");
    let host = "Source", title = "Evidence";
    try {
      const parsed = new URL(url);
      host = parsed.hostname;
      title = decodeURIComponent(parsed.pathname.split("/").filter(Boolean).pop() || "Home")
        .replace(/\.md$/, "").replace(/[-_]/g, " ");
      title = title.charAt(0).toUpperCase() + title.slice(1);
    } catch { /* Keep malformed source text inert in the component. */ }
    if (!groups.has(url)) groups.set(url, { url, host, title, items: [] });
    groups.get(url)!.items.push({ ...item, index });
  });
  return [...groups.values()];
}
