# Braintrust auth (org-scoped keys)

Braintrust API keys are **scoped to one org**, so which key you use *is* which org
the run lands in.

## Where the key comes from

The Braintrust API key is read from the `BRAINTRUST_API_KEY` environment variable,
or the `bt` CLI is authed via `bt setup`. Keys are org-scoped, so which key you use
decides which org the run lands in.

If you work across multiple orgs, keep a **separate key per org** — for example in
your project's `.env` as `BRAINTRUST_API_KEY_<ORG>` — and select the right one for
the run:

```dotenv
# your project's .env
BRAINTRUST_API_KEY=sk-...               # single-org default
# or, for a multi-org setup, one key per org:
# BRAINTRUST_API_KEY_<ORG>=sk-...
# optional, self-hosted only:
# BRAINTRUST_API_URL=https://api.braintrust.dev
```

If the needed variable is missing: ask the user to fill it in the environment /
their `.env` (never in chat), then verify with the org-list call below and confirm
the org name matches what the user picked.

## Verifying a key's org

`GET /v1/organization` can return an **empty list** even for a valid key (org-member
permissions), so don't use it to verify. List projects instead — a valid key sees
its org's projects, and the roster makes it obvious which org you're in:

```bash
curl -s "https://api.braintrust.dev/v1/project?limit=100" \
  -H "Authorization: Bearer $KEY"   # -> objects[].name; empty/401 means bad key
```

Phase 1 asks which org, then selects the matching key (`BRAINTRUST_API_KEY`, or
the per-org `BRAINTRUST_API_KEY_<ORG>` in a multi-org setup).

**Governance default:** if the eval touches sensitive / customer / proprietary
data, default to a non-shared personal org unless the user says otherwise.

## Rules

- **Never ask the user to paste a key into the chat**, and never print one. Keys
  are read from the environment only. If the chosen key is missing, point the user
  at `.env.example` and stop.
- Get a key from the Braintrust app → **Settings → API Keys**. Each org has its
  own; copy the one for the org you're targeting.

## Making model calls through Braintrust

The **gateway** gives you one OpenAI-compatible endpoint for many providers,
authed with your Braintrust key — handy for judges and for the task model.
(The older `/v1/proxy` AI proxy is deprecated; the gateway is a drop-in
replacement — same key, same OpenAI-compatible shape, just a new base URL.)

```
POST https://gateway.braintrust.dev/chat/completions
Authorization: Bearer <the org's key>
```

## Resolving a project

```bash
curl "$BRAINTRUST_API_URL/v1/project?project_name=My%20Project" \
  -H "Authorization: Bearer $KEY"   # -> objects[0].id, objects[0].org_id
```

> Duplicated into each Braintrust skill for self-containment — keep copies in sync.
