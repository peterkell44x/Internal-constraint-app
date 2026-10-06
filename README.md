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

## Deploying to Railway

`railway.json` and the `start` script (`prisma migrate deploy && next start`) are set up so the app deploys from GitHub with no terminal. The database is a SQLite file, so it needs a Railway volume to survive redeploys.

1. New project → Deploy from GitHub repo → this repo and branch.
2. Add a volume to the service with mount path `/data`.
3. Set these variables on the service:
   - `ANTHROPIC_API_KEY`: your Claude API key
   - `SIGNUP_PASSCODE`: the passcode needed to create an account
   - `DATABASE_URL`: `file:/data/app.db`
4. Generate a public domain under the service's networking settings.

Sign-up asks for the passcode. In production, if `SIGNUP_PASSCODE` is missing, sign-up is closed.

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
- The report prompt carries the chat prompt's rule against connecting dots the person never connected: separate things they said can only be presented as one pattern if they made or confirmed the link, and anything they rejected or denied cannot appear anywhere in the profile.
- The report prompt's "go three layers deeper" and "build a case" instructions are qualified to mean deeper into what the person said, never beyond it, and "hidden" and "unseen" are no longer in the constraint's example list.
- When the person confirmed a behavior cycle, the constraint must state the belief inside that cycle in their own words, and nothing they rejected may appear in the constraint or counter belief. This is a prompt rule; the check flags violations in those protected sentences but cannot remove them.
- When a conversation ends at the 16-answer limit (so no connection was confirmed), the report call is told to use only what was stated or confirmed, even if the constraint ends up less specific. The chat itself still stops at 16.
- The report prompt states its word limits as hard limits with per-paragraph sentence budgets.
- The chat prompt forbids assuming anything unstated (gender, relationship status, what happened between people, what others meant or felt) and treats anything the person says they don't know as unknown.
- The report call also gets today's date, so relative references like "last year" are not turned into a guessed year.

Denial check (`src/lib/diagnostic/denial.ts`): prompt rules alone did not stop the report building its constraint on an interpretation the person had rejected. So an audit call reads only the conversation, alongside the first draft, and lists what the person rejected (a clear no or a correction; plain uncertainty like "idk" doesn't count, but a hedged answer that still clearly denies something does) and which links they stated or clearly confirmed. After the length pass, a check call compares the report against that audit and quotes each violation (something rejected, an unconfirmed link or generalisation, or a fact they never said). The code matches each quote to the report's numbered sentences and deletes them, delete-only like the length pass: the report is never rewritten, and protected sentences are never removed. Up to 3 check-and-delete rounds. A violation inside a protected sentence (a section opening, the whole counter belief section so its action step always stays, the "architecture" sentence, the "where they stand today" and final paragraphs) can't be deleted and ships as is. If the audit or check call fails, the report ships unchecked. The audit and each round's violations, deletions and unfixable items are saved in `reportChecks`. Both calls use structured JSON output.

Debug view: accounts listed in `REPORT_DEBUG_EMAILS` (comma-separated) see a collapsed "How this report was checked" section under each completed report: the first draft, the audit's rejected, confirmed and dropped-as-uncertain lists, what each length pass and check round deleted, and violations that could not be deleted. Unset, nobody sees it. It is rendered on the server and never included in API responses.

Report generation runs in the background: the report request marks the diagnostic `generating` and returns at once, the work continues via Next's `after()`, and the page polls for the result while showing an elapsed timer that survives reloads. A second click, tab or reload doesn't start another generation. A generation stuck for over 15 minutes (for example after a server restart) can be started again. After a 4 minute time budget no new length pass or check round starts. This keeps every request short, well inside Railway's limit of 5 minutes without data.

Length pass (`src/lib/diagnostic/review.ts`): the first draft reliably runs past the word limits. When a part is over, the code splits the draft into numbered sentences and asks the model only which sentence numbers to delete. The code then rebuilds the report from the kept sentences, word for word and in their original order, so a cut can remove a sentence but never move, merge or reword one. The code also ignores deletions from parts within their limit, keeps each final section's opening sentence, the sentence containing "architecture", the "where they stand today" paragraph (the fourth of the five narrative paragraphs; not locked if the draft has a different number of paragraphs), and the final narrative paragraph (the shift), never empties a part, and discards a pass that cuts any part below half its limit. Passes repeat while a part is still over (at most 3). If the call fails, the draft is kept. The first draft is saved in `reportDraft` for comparison.

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
