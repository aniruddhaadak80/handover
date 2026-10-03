# Contributing to Handover

Thanks for looking. This project is small enough that a focused PR beats a
clever one.

## The one rule that matters

**Do not make the scoring engine guess.** If you change
`src/lib/engine/readiness.ts`, you must be able to answer: what evidence
caused this penalty, and which row or label section is it pointing at? If you
cannot, the change does not belong.

## Local setup

```bash
git clone https://github.com/aniruddhaadak80/handover
cd handover
npm install
npm run dev
```

No environment variables are required. The dev server boots an embedded
Postgres in `.data/` and talks to the public openFDA and NIH RxNorm APIs with
no key. If you want the exact production bundle locally:

```bash
npm run build
HANDOVER_ALLOW_EMBEDDED=1 npm start   # macOS / Linux
# PowerShell: $env:HANDOVER_ALLOW_EMBEDDED="1"; npm start
```

## Before you open a PR

```bash
npm run typecheck   # tsc --noEmit
npm run lint        # eslint .
npm run test        # vitest: engine, seal chain, extractor, real store
npm run build       # production build
```

All five must pass. Then, with the app running locally:

```bash
npm run test:e2e                 # Playwright, desktop + mobile
BASE_URL=https://your-deploy.vercel.app npm run test:e2e   # against a deployment
BASE_URL=https://your-deploy.vercel.app npm run verify:live
```

## Adding a factor

1. Add the key to `FactorKey` in `src/lib/types.ts` and a default weight in
   `DEFAULT_WEIGHTS` in `src/lib/engine/readiness.ts`.
2. Write the factor function so it is pure: no `Date.now()`, no randomness, no
   I/O. The reference moment arrives as the `asOf` parameter.
3. Emit `Penalty` items that name the `entryId` or the upstream source so the UI
   can cite the source.
4. Add tests for the normal case, the boundary, the empty board, malformed
   input, and a repeat run that must be byte-identical.
5. Bump `ENGINE_VERSION` in `src/lib/types.ts`. It is a data contract: briefs
   and exports quote it.

## Adding an MCP tool

Tools live in `src/lib/mcp.ts`. A mutating tool must:

- go through `src/lib/repo/store.ts`, never raw SQL of its own;
- accept an `idempotencyKey` and honour it, so a retry cannot double-write;
- be scoped to `context.sessionId`;
- return the seal from the audit event it appended.

## Style

- Server components by default. `"use client"` only for interaction, browser
  APIs or forms.
- No new runtime dependency without a reason in the PR description.
- Accessibility is a requirement, not a follow-up: visible focus, labelled
  controls, `prefers-reduced-motion` respected.
- Plain words over clever words. The user may be reading this at 3am.

## Reporting a safety problem

Do not open a public issue for anything that could affect someone's medication.
See [SECURITY.md](./SECURITY.md).