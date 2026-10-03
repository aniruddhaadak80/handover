# Security policy

## Scope

Handover stores records about real people's care: medication schedules,
observations and notes written by family members. Treat every issue here as
sensitive.

## What this project will never do

- It never instructs a dose change. It surfaces record-keeping gaps and the
  presence of public label sections, and stops there.
- It never stores a secret, an API key, or a raw regulatory document beyond a
  truncated, clearly attributed excerpt.
- It never renders user text as HTML. Excerpts are plain text.

## Supported versions

Only the latest commit on `main`.

## Reporting a vulnerability

Use GitHub's private vulnerability reporting on this repository
(<https://github.com/aniruddhaadak80/handover/security/advisories/new>).
Please include the route, the request, and what you observed.

Please do not open a public issue for anything that could change how a person
handles a medication. Send that straight to the private channel.

## Security design as built

| Area | Measure |
| --- | --- |
| Ownership | Anonymous session id in an HTTP-only, `SameSite=Lax` cookie. Every query is scoped by `owner_id`. There are no accounts to steal. |
| Ownership scope | 128 bits of `crypto.getRandomValues` entropy. It is minted in Edge middleware before any handler runs, so server components can trust it. |
| SQL | Parameterised queries only. No string interpolation of user input into SQL anywhere. |
| Input validation | Every mutating body passes a Zod schema with length and enum bounds. Bodies over 64 kB are refused. |
| Destructive actions | Board deletion requires `confirm=<boardId>` and returns 428 without it. Entry deletion requires `confirm=<entryId>`. Both are soft: the row is retained as a tombstone so the audit chain stays replayable. |
| Agent mutations | Every tool is scoped to the calling session and supports an idempotency key, so a retried tool call cannot double-write. |
| Write integrity | Each domain row and its audit event are written in one SQL statement, so a row can never exist without its sealed audit event. |
| Error responses | Stable error envelopes with a code and a message. No stack traces, no SQL, no environment values, ever. Upstream URLs are reduced to origin and path before they can reach a log. |
| Secrets | No secret is present in the client bundle, the repository, the manifest, or any response. Production needs exactly one variable: `DATABASE_URL`. |
| External calls | Time-boxed with bounded retries, a stale cache, and an allowlisted set of origins (openFDA, NIH RxNorm). |
| Abuse controls | Best-effort: per-session cookie ownership, body size caps, and validation. Anonymous write rate limiting is **not** enforced in-process, because serverless instances are ephemeral and a per-process counter is not a real limit. Put a hosted limiter in front of `/api/boards` and `/api/mcp` if you expose this publicly at scale. |

## Known limitations

- Anonymous ownership means clearing cookies loses access to a board. This is a
  deliberate trade for zero-friction onboarding; a real deployment that needs
  multi-device access should add accounts.
- The deterministic engine is not a clinical device and is not validated as one.
- Label excerpts are truncated. The full text lives with the regulator.