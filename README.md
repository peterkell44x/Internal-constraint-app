# Internal Constraint

A personal growth app built around finding a person's subconscious **internal constraint**: the limiting belief formed through childhood verbal programming, modeling and specific incidents (after the money blueprint framework in *Secrets of the Millionaire Mind*). It covers four domains: Money & Abundance, Love & Relationships, Fitness & Health, and Happiness & Peace.

This first phase has:

- **Accounts:** email and password sign up, log in and log out.
- **The diagnostic engine**, ported from the standalone prototype with the same behavior.
- **Saved reports:** every completed diagnostic is stored on the user's account. Unfinished conversations are saved too and can be picked up later.

## The Architect diagnosis (current)

New diagnoses use a fixed 8-step flow (code in `src/lib/diagnostic/v2/`, stored as `version = 2`):

- **Questions:** 8 fixed questions per domain, with a progress bar (12.5% per answer). Each question has a grey hint line, which is shown only and never sent to the AI. After the reaction to answer 8, one "Show me my report" button starts the report. (Earlier diagnostics also had 2 Yes / No taps; their saved taps are still read so they open, but are not shown or used.)
- **Reactions:** after each answer, the AI writes a short reaction.
  - Reactions mirror what the person said and add one light meaning that stays inside it, following a shape set for each question. They draw no cause and effect from the past unless the person made that link.
  - Boldness is tone only: gentle (answers 1 to 3), medium (4 and 5), direct (6 to 8). A thin answer (under 25 words) gets a mild reaction.
  - Each reaction returns an anchor: words copied from the answers. The code checks the anchor is really there, forgivingly (case, punctuation and contractions ignored; "I / my" and "you / your" count as the same word, and so do "he / she / they"; a run of at least 4 words after dropping the first one or two also counts, which covers "he" for "my dad"), and retries once if not. If it is still not found, or the AI call fails, the question's neutral line (in `prompts.ts`) is shown instead. A reply with the crisis flag skips the anchor check and is shown as written, never replaced by a neutral line.
  - The code deletes sentences that:
    - comment on the person's words ("the word X shows up 4 times")
    - tell them what they "actually" want, or reach for a cause ("runs your")
    - use "chase"
    - make a teaser claim ("no accident", "not a coincidence") or use "pull the floor out"
    - use a timing or reference back the person never used ("at the same time", "simultaneously", "at once", "the old fear")

    It also replaces dashes, and cuts at a sentence end past 70 words. The same banned phrases and word echoes are deleted from report cards.
- **Saving and resume:** every step is saved, and a reload continues at the same step.
- **Report:** after the button, one AI call writes a 12-card report: Where it started, Uncovered internal constraint, Life by default and Life by design, 3 cards each. Then the Life by default / Life by design bullets; the checks never remove or edit a bullet (a flagged bullet is kept and listed in the debug view), so each list keeps the three the AI wrote. The report gives no action or advice. The two fixed closing lines ("That is your default: the way you move when you are not choosing." and "That is your design.") are placed once by the code; the earlier default wording is removed if the AI writes it (reports saved with it keep it). The AI fact check never touches these two lines. Section names and the bullet headings are shown in Title Case. The report also returns a `constraint` sentence ("Your internal constraint is the belief that ..., and it is what stands between you and ..."); the code puts it as the last sentence of Uncovered internal constraint card 3 in place of that card's section point, and it goes through the same checks. If it is missing, one more call writes only that sentence; if that fails, the report ships without it. The reply also starts with an optional `belief` (the old belief in one plain phrase); if it is missing, it is taken from the constraint. The repeat check never deletes the sentence of Life by design card 2 that holds the belief, the "Stop letting ..." and "Act as if ..." sentences of Life by design card 3, or the constraint sentence (an earlier copy of the constraint is removed instead).
- **Checks:** every number and quoted phrase must come from the answers (a difference between two ages or years they gave is allowed). There is also:
  - no banned wording (including "chase")
  - no advice wording. "I recommend" always counts; every other phrase on the list ("pause before", "ask yourself", "try to", "take a moment", "you should" and so on) counts only as an instruction: at the start of a sentence (after an optional "Then," or "So,") or after should, could, need to, must, let's or you can
  - no em or en dashes
  - no duration or frequency ("for years", "always") the person did not use: the answers must have the phrase together with the word that follows it in the report ("always skinny" does not back "always take"). The belief is checked first: an unbacked "always" or "constantly" is removed from it (and from the constraint and Life by design cards 2 and 3); other unbacked phrases in it are only flagged in the debug view
  - no timing or reference back ("at the same time", "simultaneously", "at once", "the old fear") the person did not use
  - vague lines ("where the real pattern lives", "if there is one") are deleted straight away

  A failing card is rewritten once; a number fix may only remove the number. Then the failing sentences are deleted, and dashes become commas.
- **Repeats** (a sentence or 8-word phrase from an earlier card, or a 5-word phrase twice inside one card) are deleted first. The card is rewritten only if that leaves fewer than 2 sentences or 25 words, or more than half its sentences repeated.
- **AI fact check:** one call (retried once) returns entries with a verdict, DELETE or EDIT (removing words only). The code refuses an edit that adds or changes words (it becomes a delete), and ignores an entry whose reason says to keep the sentence ("rescind", "is fine", "no change needed") or whose note withdraws the flag ("withdrawing"). An idiom or cliche entry (recognised from its note) whose edit swaps words is refused and the sentence kept, not deleted. Each card that lost a sentence then gets one narrow call for sentences left pointing at what was deleted, or claiming proof that is no longer there. A delete that would leave a card under 25 words (closing line not counted) is applied as its edit if it has a valid one, and otherwise not applied; cards just rewritten are not protected this way. After the last code checks, a card under 25 words is rewritten once, told which sentences were deleted and why. Every card rewritten after the main check (or put back after a failed rewrite) gets the code checks and one more AI fact check, all in one call. A rewrite that fails, or leaves a card under 15 words, is discarded and the earlier version put back.
- **Prompts:** every AI instruction and all question text is in one file, `src/lib/diagnostic/v2/prompts.ts`, to be tuned after real runs.
- **Crisis:** a reaction with `crisis: true` shows a 988 support line and makes the report SENSITIVE.
- **Debug view:** for `REPORT_DEBUG_EMAILS`, it shows the hidden tie, each reaction's anchor and checks, retries, the constraint sentence (where it came from and what happened to it), rewritten cards, deleted and edited sentences, ignored AI check entries, the per-card checks after deletions, whether the AI check succeeded, why a report reply failed its shape, the belief and where its exact words were found, deletes kept because the card would be too short, and for each rewritten card whether it was fact-checked or discarded.
- **Old pipeline:** the open-ended chat and its multi-round report pipeline (described below) are retired. Their files are kept for rollback, and earlier reports (`version = 1`) still open in the old format.

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
- The counter belief's action must be something the person can do and check off this week that tests the belief and produces something tangible (a record, a number, a message sent). This is a prompt rule only.
- The 16-answer limit is enforced in code: the 16th answer always ends the conversation and the server refuses any later answer. The model is not asked for a reply to the 16th answer (told to close, it still sometimes asked a new question); the guide says a fixed line instead: "I have what I need to build your profile now. Go ahead and click Generate Profile Report."
- A final guide message that asks a question the person never answered is left out of what the report, audit and checks see.
- When asked where a belief came from, the chat accepts idk or any source (online, a person, a recent moment) as the answer, asks at most one follow-up, then moves on to how the belief shows up and what it blocks. The report's opening describes the origin the person actually gave and never invents or borrows a childhood origin. Prompt only.
- The report and rewrite prompts require every sentence to read as normal prose, with no stitched fragments or lists of quoted phrases. Prompt only.
- When a conversation ends at the 16-answer limit (so no connection was confirmed), the report call is told to use only what was stated or confirmed, even if the constraint ends up less specific. The chat itself still stops at 16.
- The report prompt states its word limits as hard limits with per-paragraph sentence budgets: 340 words for the narrative, 100 for the constraint, 75 for the counter belief.
- The report prompt treats the person's answer to "what brought you here" as their stated problem: the constraint's last sentence connects the belief to what they experience around that problem (how it makes them think, feel or act about it) and never claims the belief causes events outside their control, such as injuries; the counter belief may name the part of the problem its action tests, only in natural words (prompt only). For the constraint it is also enforced: a call extracts the stated problem once as a short phrase; the constraint's last sentence is never deleted; each check round a model call judges whether that sentence meets the definition above, and if not the constraint goes to the rewrite; a constraint rewrite that fails the same judgment is rejected; and if the constraint still fails after the checks, it gets one more rewrite, which replaces it only if it passes the judgment (not re-checked otherwise).
- The chat must not challenge or offer a "here is what I am noticing" read before the person has given one concrete example, must not use judgment phrases like "not that long", and must not re-ask an answered question. Prompt only.
- Within its first three questions the chat must ask what specific problem or frustration brought the person here, in their own words, and build later questions on that answer. Prompt only.
- The chat prompt forbids assuming anything unstated (gender, relationship status, what happened between people, what others meant or felt) and treats anything the person says they don't know as unknown.
- The report call also gets today's date, so relative references like "last year" are not turned into a guessed year.

Denial check (`src/lib/diagnostic/denial.ts`): prompt rules alone did not stop the report building its constraint on an interpretation the person had rejected. So an audit call reads only the conversation, before the first draft, and lists what the person rejected (a clear no or a correction; plain uncertainty like "idk" doesn't count, but a hedged answer that still clearly denies something does), what they were unsure about (hedged answers like "yeah kind of" or "maybe"; an answer that agrees in part and denies in part is split between unsure and rejected; the report may use unsure items only with hedged wording, and every check flags any of it stated as fact) and which links they stated or clearly confirmed. The draft waits for the audit and is given its rejected and unsure lists, with the rule that nothing on it may be used as the architecture, the spine of the narrative, the constraint or the final paragraph (a prompt rule alone did not stop that). Right after the length pass, a sentence it deleted is put back if a kept sentence uses a number or name (digits, or a capitalised word that isn't the first in its sentence) that only the deleted sentence introduced; it goes just before the first sentence that uses it, so the narrative can end up a little over its limit. Then the reference repair runs over the length-pass deletions. Then a check call compares the report against that audit and quotes each violation (something rejected, an unconfirmed link or generalisation, a fact they never said, something unsure stated as fact, or something stated more firmly or broadly than they said it). Each flag must say whether the checker stands behind it, and the code ignores any flag marked false or whose reason takes it back ("withdrawing this one"). The check treats the constraint as an inference by design: it is not flagged just because the person never stated that belief, only if it uses something rejected or claims an origin the person did not confirm. Checks done by code every round: a counter belief not stated in first person, which sends it to the rewrite; an absolute (only, always, never, impossible, unsafe, permanent or permanently, forever, every time) in the constraint or counter belief that the person never used, which sends that section to the rewrite; and a narrative sentence that shares a run of 6 or more words with a sentence in an earlier paragraph, where the first copy stays and the later one is deleted, or rewritten with its paragraph if it is protected. The check runs up to 3 times. After each check: a sentence flagged as unsure or overstated is rewritten to hedge it (only that sentence, guarded like the repair, and allowed to add up to 25 words) rather than deleted, falling back to deletion if that fails; in checks 1 and 2, an unprotected narrative sentence flagged as an unconfirmed link or unsaid detail is trimmed to what the person confirmed rather than deleted, and deleted if the trimmed sentence is flagged again; other flagged sentences that aren't protected are deleted (matched to the report's numbered sentences); a reference-repair call fixes kept sentences that point at something only a deleted sentence introduced, and checks that a paragraph whose last sentence was deleted still makes its point (each repair must name one sentence; a block of several is split into its changed sentences, or asked for again once; a repair may not cut more than 5 words from a protected sentence), and the code refuses any repair that brings back wording from a deleted sentence or from something the person rejected; and, after each check except the last, each section or paragraph holding a flagged protected sentence (section openings, the counter belief, the architecture sentence, the "where they stand today" and final paragraphs) is rewritten from the confirmed and rejected lists, at most twice per section. The word limit for a rewrite is 100 for the constraint, the larger of 75 and the current length for the counter belief (it is locked, so the draft's can be longer), and what the narrative has left for a paragraph, and the rewrite is told it. A paragraph rewrite may run up to 20 words over its limit, as long as the whole narrative stays within 360 words; a rejected paragraph rewrite is asked for once more, told its exact word limit and why it was rejected. The code rejects a rewrite that is over its word limit, has a counter belief not in first person, loses its required opening or the word architecture, uses one of the absolutes above when the person never did, or (for a paragraph) repeats a run of 6 or more words from another paragraph, and keeps the original. A sentence locked in the draft stays locked for the rest of the checks, wherever deletions move it. What the third check's hedges, deletions and repair produce is not checked again. "Not said" flags about numbers are dismissed when every number in the quote appears in what the person said, in any form ("4-5 years" and "four to five years" match). If the audit or check call fails, the report ships unchecked. The audit and each round's violations, deletions and unfixable items are saved in `reportChecks`. Both calls use structured JSON output.

Debug view: accounts listed in `REPORT_DEBUG_EMAILS` (comma-separated) see a collapsed "How this report was checked" section under each completed report: the first draft, the audit's rejected, confirmed and dropped-as-uncertain lists, what each length pass and check round deleted, and violations that could not be deleted. Unset, nobody sees it. It is rendered on the server and never included in API responses.

Report generation runs in the background: the report request marks the diagnostic `generating` and returns at once, the work continues via Next's `after()`, and the page polls for the result while showing an elapsed timer that survives reloads. A second click, tab or reload doesn't start another generation. A generation stuck for over 15 minutes (for example after a server restart) can be started again. After a 4 minute time budget no new length pass or check round starts. This keeps every request short, well inside Railway's limit of 5 minutes without data.

Length pass (`src/lib/diagnostic/review.ts`): the first draft reliably runs past the word limits. When a part is over, the code splits the draft into numbered sentences and asks the model only which sentence numbers to delete. The code then rebuilds the report from the kept sentences, word for word and in their original order, so a cut can remove a sentence but never move, merge or reword one. The code also ignores deletions from parts within their limit, keeps each final section's opening sentence, the sentence containing "architecture", the "where they stand today" paragraph (the one just before the final paragraph, when the draft has five or more paragraphs), and the final narrative paragraph (the shift), never empties a part, and discards a pass that cuts any part below half its limit. Passes repeat while a part is still over (at most 3). If the call fails, the draft is kept. The first draft is saved in `reportDraft` for comparison.

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
