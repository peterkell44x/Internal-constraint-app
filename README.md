# Internal Constraint

A personal growth app built around finding a person's subconscious **internal constraint**: the limiting belief formed through childhood verbal programming, modeling and specific incidents (after the money blueprint framework in *Secrets of the Millionaire Mind*). It covers four domains: Money & Abundance, Love & Relationships, Fitness & Health, and Happiness & Peace.

This first phase has:

- **Accounts:** email and password sign up, log in and log out.
- **The diagnostic engine**, ported from the standalone prototype with the same behavior.
- **Saved reports:** every completed diagnostic is stored on the user's account. Unfinished conversations are saved too and can be picked up later.

## Stack

- **Next.js 16** (App Router, TypeScript), for both the UI and the backend route handlers
- **Prisma 7** with **SQLite** for local development (see [Moving to Postgres](#moving-to-postgres))
- **Anthropic TypeScript SDK**, called only from the server so the API key never reaches the browser
- Sessions: random token in an httpOnly cookie, SHA-256 hash stored in the `Session` table. Passwords hashed with bcrypt.

## Getting started

```bash
npm install                 # also generates the Prisma client
cp .env.example .env        # then set ANTHROPIC_API_KEY
npm run db:migrate          # creates dev.db and applies migrations
npm run dev                 # http://localhost:3000
```

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Database connection string. Default `file:./dev.db` |
| `ANTHROPIC_API_KEY` | Claude API key. Server only |
| `ANTHROPIC_MODEL` | Optional. Defaults to `claude-sonnet-4-6`, the model the prototype was tuned on |

Other scripts: `npm run build`, `npm run lint`, `npm run typecheck`, `npm test`.

## How the diagnostic engine was ported

The prototype (`reference/internal-constraint-diagnostic.html`) is kept in the repo as the source of truth.

| Prototype | App |
| --- | --- |
| `DOMAINS` | `src/lib/diagnostic/domains.ts` (copied verbatim) |
| `buildSystemPrompt`, `buildReportSystem`, `READY_MARKER`, `HARD_CEILING`, `FORCE_CLOSE_SYSTEM_PROMPT` | `src/lib/diagnostic/prompts.ts` (copied verbatim) |
| `stripDashes`, marker handling, `[SPLIT]` parsing | `src/lib/diagnostic/text.ts` |
| `callClaude`, `startConversation`, `sendMessage`, report generation | `src/lib/diagnostic/engine.ts` (server side) |
| Chat UI | `src/components/DiagnosticSession.tsx` |

The model call is the same as before: same model, `max_tokens: 1000` for chat turns (2000 for the report, so it is never cut off), the same system prompts, the same `"Begin the diagnostic."` opener and `"Please generate my profile report now."` request, and dashes stripped from every reply. The 16-answer hard ceiling switches to the force-close prompt as before. The `[READY_FOR_REPORT]` marker ends the conversation and unlocks the report button.

`tests/parity.test.ts` loads the prototype's own JavaScript and checks that every domain's prompts, the constants and the dash stripping come out byte-for-byte identical. **If you retune a prompt, change it in both places** (or update the reference file) so the test keeps guarding it.

Prompt changes made after porting (applied to both `prompts.ts` and the reference file):

- The report prompt allows only facts, numbers and events the person stated: no math on their numbers, and no invented dates, timing words, scenes or quotes. Interpretations, including confident ones, are allowed only when built visibly from what they said.
- The report prompt states its word limits as hard limits with per-paragraph sentence budgets.
- The chat prompt forbids assuming anything unstated (gender, relationship status, what happened between people, what others meant or felt) and treats anything the person says they don't know as unknown.
- The report call also gets today's date, so relative references like "last year" are not turned into a guessed year.

Length pass (`src/lib/diagnostic/review.ts`): the first draft reliably runs past the word limits. When a part is over, the server sends the draft back with its measured word counts and per-paragraph budgets to be cut, and repeats while still over (at most 3 passes). This pass only shortens. It does not see the conversation, check facts or soften conclusions. A malformed result is discarded, and if the call fails the draft is kept. The first draft is saved in `reportDraft` for comparison.

Other differences from the prototype, all outside the prompts:

- The conversation lives in the database, so a reload or a new device picks up where you left off.
- If an API call fails, the answer is not saved and goes back into the input box to resend. In the prototype it stayed in the history, which could leave two user turns in a row.
- The server enforces the flow (no answers after the readiness marker, no report before it) and rejects a second tab answering the same turn.
- "Switch domain" leaves the current diagnostic saved as in progress instead of discarding it.

## Data model

- `User`: email, optional name, password hash
- `Session`: login sessions (hashed token, expiry)
- `Diagnostic`: one conversation per domain. Holds the full message history exactly as sent to the model, the answer count, status (`in_progress`, `ready`, `completed`), and the parsed report (`narrative`, `constraint`, `counterBelief`, plus the raw text)

Later features (morning routine, habit tracker, gratitude journal) can add their own models related to `User`.

## Moving to Postgres

SQLite is a zero-setup default for local work. For a hosted deployment, switch to Postgres:

1. `npm install @prisma/adapter-pg pg` and remove the better-sqlite3 adapter.
2. In `prisma/schema.prisma`, set `provider = "postgresql"`.
3. In `src/lib/db.ts`, create the client with `new PrismaPg({ connectionString: process.env.DATABASE_URL })`.
4. Delete `prisma/migrations` and run `npm run db:migrate` to create a fresh Postgres migration.
