# Pulling results (BTQL, paginated + cached)

Pull experiment/log rows once, cache to disk, analyze off the cache. Re-pulling many
experiments is slow and 429-prone. Distilled from a shared helpers module in your
project.

Base URL `BRAINTRUST_API_URL` (default `https://api.braintrust.dev`); auth
`Authorization: Bearer <the org's key>` (selected in Phase 1 — don't re-prompt).

## The three gotchas

1. **Fetch caps at 1000 rows** — you must paginate or you silently analyze a partial set.
2. **The BTQL cursor is a *query clause*, not a body field.** Passing it in the request
   body silently loops the same page; you must append `| cursor: '<c>'` to the query.
3. **Rate limits are real** — throttle between pages (~3s to stay under 20 req/min) and
   retry 429 honoring the "Retry after N" in the message.

## Paginated pull with retry

```python
import os, re, time, json, requests
API = os.environ.get("BRAINTRUST_API_URL", "https://api.braintrust.dev").rstrip("/")
KEY = os.environ["<the org's key var>"]           # e.g. BRAINTRUST_API_KEY (or BRAINTRUST_API_KEY_<ORG>)
HDR = {"Authorization": f"Bearer {KEY}", "Content-Type": "application/json"}

def _post(query, timeout=45):
    for attempt in range(8):
        try:
            r = requests.post(f"{API}/btql", headers=HDR,
                              json={"query": query, "fmt": "json"}, timeout=timeout)
        except requests.RequestException:
            time.sleep(min(2**attempt, 20)); continue
        if r.status_code == 429:
            m = re.search(r"Retry after ([\d.]+)", r.json().get("Message", ""))
            time.sleep(float(m.group(1)) + 1 if m else 60); continue
        if r.status_code in (502, 503, 504):
            time.sleep(min(2**attempt, 30)); continue
        r.raise_for_status(); return r.json()
    raise RuntimeError("BTQL: exhausted retries")

def btql_all(query, page=1000, throttle=3.2):
    """query must NOT include a limit: clause; this adds one per page."""
    rows, seen, cursor, first = [], set(), None, True
    while True:
        if not first: time.sleep(throttle)
        first = False
        q = f"{query} | limit: {page}" + (f" | cursor: '{cursor}'" if cursor else "")
        out = _post(q)
        batch = [r for r in out.get("data", []) if r.get("id") not in seen]
        for r in batch: seen.add(r.get("id"))
        rows.extend(batch)
        cursor = out.get("cursor")
        if not cursor or not batch: return rows

def cached_pull(query, cache_path, **kw):
    if os.path.exists(cache_path):
        return json.load(open(cache_path))
    rows = btql_all(query, **kw)
    os.makedirs(os.path.dirname(cache_path) or ".", exist_ok=True)
    json.dump(rows, open(cache_path, "w"))
    return rows
```

Delete the cache file to force a refresh. Then load into pandas
(`pd.json_normalize(rows)`) and run every analysis against the cached frame.

> The full battle-tested version (project/BTQL helpers, DataFrame wrappers) can live
> in a shared helpers module in your project — reuse it rather than hand-rolling.
