# Braintrust auth (org-scoped keys)

Braintrust API keys are **scoped to one org**, so which key you use *is* which org
the data comes from.

## Where the key comes from

The Braintrust API key is read from the `BRAINTRUST_API_KEY` environment variable,
or the `bt` CLI is authed via `bt setup`. If you work across multiple orgs, keep a
separate key per org — for example in your project's `.env` as
`BRAINTRUST_API_KEY_<ORG>` — and select the right one for the pull:

```dotenv
# your project's .env
BRAINTRUST_API_KEY=sk-...               # single-org default
# or, for a multi-org setup, one key per org:
# BRAINTRUST_API_KEY_<ORG>=sk-...
# optional, self-hosted only:
# BRAINTRUST_API_URL=https://api.braintrust.dev
```

Preflight asks which org, then selects the matching key (`BRAINTRUST_API_KEY`, or
the per-org `BRAINTRUST_API_KEY_<ORG>` in a multi-org setup).

**Governance default:** if the data is sensitive / customer / proprietary, default to
a non-shared personal org unless the user says otherwise.

## Rules

- **Never ask the user to paste a key into the chat**, and never print one. Keys are
  read from the environment only. If the chosen key is missing, point the user at
  `.env.example` and stop.
- Get a key from the Braintrust app → **Settings → API Keys**. Each org has its own.

## Resolving a project

```bash
curl "$BRAINTRUST_API_URL/v1/project?project_name=My%20Project" \
  -H "Authorization: Bearer $KEY"   # -> objects[0].id, objects[0].org_id
```

> Duplicated into each Braintrust skill for self-containment — keep copies in sync.
