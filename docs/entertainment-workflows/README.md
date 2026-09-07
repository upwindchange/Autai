# How the entertainment, internet-fetch, and chaptered-novel agents work together

This guide explains, in plain language, how the AI helpers ("agents") inside
Autai's entertainment mode cooperate when you turn a web novel (or an uploaded
novel file) into a cleaned-up book. It covers the three book-making routes,
including the internet fetch route and the chaptered-novel route, and it pairs
with the five Mermaid diagrams sitting next to this file.

Read this file side by side with the matching diagram:

| Diagram file                         | What it shows                                                              |
| ------------------------------------ | -------------------------------------------------------------------------- |
| `01-big-picture.mmd`                 | All the pieces at a glance and how they connect                            |
| `02-chaptered-internet-fetch.mmd`    | The step-by-step hunt for one chapter on the internet (the "ladder")       |
| `03-rewrite.mmd`                     | How the text actually gets cleaned and rewritten                           |
| `04-scheduler-rules.mmd`             | Who is allowed to run when (the house rules)                               |
| `05-user-journey.mmd`                | The same story from your point of view: screens, buttons, and web requests |

## The big picture (pairs with `01-big-picture.mmd`)

Entertainment mode is a second app-within-the-app. You switch to it with the
sidebar switch (the mode dropdown in `nav-secondary.tsx` changes `appMode`).
From that moment there is **no chat box and no chatting AI**. Everything you do
happens through book setup screens and a reading screen, and every button
presses a quiet web address (REST route) served by the app's backend
(`POST /entertainment/...`). The chat AI (`POST /chat`) keeps running for chat
mode only — entertainment mode never talks to it.

Behind the scenes there is one gatekeeper called the scheduler
(`entertainmentWorker/scheduler.ts`). All background book work funnels through
it. The scheduler looks at the book's saved setup and picks one of three
routes:

1. **Route 1 — book from a text file** (`pipeline1ChapteredFile`). You upload a
   `.txt`; the app reads it straight from disk and rewrites it bite by bite.
2. **Route 2 — chaptered book from the internet** (`pipeline2ChapteredInternet`).
   The book has chapters, and the app must find and read them from websites,
   one chapter at a time, then rewrite each one. This is the "internet fetch
   mode + chaptered novel mode" combination.
3. **Route 3 — one long web page, no chapters** (`pipeline3NonChapteredInternet`).
   You ticked the "non-chaptered" choice in the wizard; the app reads one page
   once and rewrites it as a single chapter. It never searches and never splits.

Two AI helper groups do the actual reading and writing:

- **Reading helpers** — five small browser-reading agents in
  `pipeline2ChapteredInternet/internetFetch/agents.ts` (find the book, open
  chapter N, click "next", copy the chapter text, prove the book ended), plus
  the web-search machinery borrowed from chat mode's research feature
  (`browserWorker/browser-research/search-agent.ts`, entry
  `executeSearchQueries`). Route 3 has its own simpler one-page reader inside
  `fetchSinglePage.ts`.
- **Writing helper** — the rewriting agent (`pipeline2ChapteredInternet/rewriter.ts`
  for internet routes, `pipeline1ChapteredFile/rewriter.ts` for file routes).
  It re-reads your wizard/options choices and produces the cleaned text.

Everything the agents do is remembered in a small database so nothing is lost
when you close the app: the copied original text goes in one table
(`source_chapters`), the cleaned text in another (`rewritten_chapters`), and
per-book knowledge — your choices, blocked sites, the site the book lives on,
the final chapter number — in `entertainment_configs`. The reading screen
polls the database through `GET /entertainment/threads/:id/chapters/:n` every
1.5 seconds until the chapter you're on is ready, and the server also pushes an
`entertainment:chaptersChanged` event after every write so chapter lists stay
fresh.

## Chaptered internet fetch (pairs with `02-chaptered-internet-fetch.mmd`)

One function, `fetchInternetChapter()`, is responsible for getting **one**
chapter. It never throws for expected problems; it answers with one of three
words: `fetched`, `finalChapter` (the book just ended), or `error`. The
scheduler's `fetchLoop` calls it over and over, one chapter after another,
strictly one at a time (they share one hidden browser tab).

Each chapter is found through a **ladder of three rungs**, tried top to bottom:

1. **Advance from the previous chapter** (cheapest). If chapter N−1's page URL
   was saved earlier, the crawler opens it and the advance agent clicks the
   "next chapter" control. If the page has no next control, the finality-proof
   agent checks the book's chapter list to make sure the book really ended —
   only a proven end counts, because a paywalled tail page can masquerade as
   the end.
2. **Use remembered knowledge** ("site anchors"). Once any site is proven to
   host this book, its address is saved. Later chapters open that site's
   chapter list directly and the target agent finds chapter N in it. A wrong
   landing is retried up to 2 times, and the agent is told what went wrong so
   it can self-correct.
3. **Search the web for the book** (most expensive). The search query is built
   by plain code — title plus author, never invented by an AI — and runs on the
   same search machinery the chat mode's research feature uses
   (`executeSearchQueries`). Candidate sites are tried one by one; the
   find-the-book agent confirms whether a candidate really is our book, and
   the first confirmed site becomes the new anchor.

Sprinkled through the ladder are safety checks:

- **Walls.** After every page opens, a cheap code check
  (`runDomWallProbe`) scans the page text for paywall/login/captcha phrases
  (VIP章节, 登录后阅读, captcha, …). A hit blacklists the site for this book
  without spending an AI call. The agents also carry a `reportWall` tool to
  call out walls the text scan missed.
- **Dead ends.** A site that lands on the wrong chapter twice, or hands back
  too little text (under 500 characters), gets marked "dead end" and skipped.
  Blocked-site knowledge persists in the database, so the book never wastes
  time on the same dead site again — until book end, "Reset", or your pasted
  link clears it.
- **Budgets.** Per chapter: at most 10 minutes, at most 3 different sites, at
  most 2 landing retries per site. The host that gets blocked is always the
  site that actually opened (the address bar after redirects), never the link
  text — so a search-engine wrapper link can't get the search engine itself
  banned.
- **The override path.** In the reading screen's footer menu you can paste the
  page you are reading ("chapter link"). That link is treated as the truth: no
  search, no verification, the chapter is simply copied from it. Its site is
  removed from the blocked list because you vouch for it.

If a chapter fails anyway, the loop stops, the chapter shows an error, and the
footer's "Redo failed" button re-enqueues it.

Route 3 (non-chaptered) is deliberately simpler: it navigates straight to the
saved web address — no search, no ladder — copies the whole page as one
chapter, and never splits it.

## Rewriting (pairs with `03-rewrite.mmd`)

For internet books, every chapter is rewritten the moment its fetch finishes
(`rewriteChapter`, one chapter = one agent call). For file books, one loop
(`runDehydrateLoop`) chews the uploaded text in bites: it first measures how
"thick" the text is for the model with a tiny throwaway sample
(`probeCharsPerToken`), then computes each bite's size from that measurement —
small bites at first so reading starts quickly, bigger bites after. If a bite
ends mid-scene, the half-finished chapter is glued to the front of the next
bite so the story continues seamlessly.

Before any rewrite, the wizard/options choices are baked into one instruction
sheet (`buildDehydrateSystemPrompt`) — grammar fix, slang filter, the
filler-stripping dials with their per-tactic checkboxes, polish/expand levels,
translation, and your free-form note. File books rebuild this sheet before
every bite, so live option edits apply immediately.

Both routes share one strict delivery rule: the agent must hand the new text
over by **calling its `outputChapter` / `outputProcessedContent` tool** — plain
typed text does not count. If it forgets, one retry runs with a firmer
reminder; a second miss marks the chapter "error" for "Redo failed".

## The scheduler's house rules (pairs with `04-scheduler-rules.mmd`)

- Jobs start from exactly four places: wizard "Upload & Continue"
  (`POST /ingest`), wizard "Fetch & Continue" (`POST /prefetch` — fetch only,
  so you can keep choosing options while it fills the library), opening the
  reading screen (`PUT /reader-cursor` — this is also the resume signal), and
  the footer "Process" item (`POST /resume`).
- **One job per book** — starting a new job aborts the old one first.
- **Only the book you're looking at runs** — switching books or leaving the
  reader aborts the previous job (and waits for it to wind down before
  cleaning up its browser tabs).
- Everything is **safe to re-run**: already-saved chapters are skipped when
  fetching, already-rewritten chapters are skipped when rewriting, and an
  aborted fetch leaves its row "fetching" (not "error") so the next run simply
  redoes it.
- The one tricky resume decision: on opening an internet book, if **no**
  chapter has ever been rewritten, the scheduler only fetches (you haven't
  committed your options yet); the moment you are reading a chapter and it
  exists, fetch+rewrite begins via the reader-cursor resume rule.

## Your journey through the screens (pairs with `05-user-journey.mmd`)

1. **Setup wizard.** Screen "Style" picks the treatment (only "dehydrate" is
   live; audiobook is a coming-soon placeholder) and checks both agent models
   are configured. Screen "Story" points at the book: upload a file, or give a
   link (direct chapter link is fastest, chapter-list or any book-page link is
   slower) or just title+author for a web search — plus the "non-chaptered"
   choice for single-piece sources and an optional start-at-chapter number.
   The Next button here already starts background work (upload/ingest or
   fetch/prefetch). Screen "Options" tunes the cleaning; its Start button
   opens the reading screen at your chosen chapter.
2. **Reading screen.** It asks the backend "is this chapter ready?" every 1.5
   seconds (`GET /chapters/:n`) until it is. Cleaned text appears only for
   rewritten chapters; everything else shows a status placeholder ("fetching",
   "rewriting", "queued", …) with matching animations.
3. **Footer menu.** Process (resume), Redo failed (with a count), Chapter link
   (paste the page you're reading), Reset (forget site knowledge), and Export
   (download rewritten chapters as `.txt`). The options editor can also be
   opened live to change cleaning choices mid-book (`GET`/`PUT /config`).

## Worth knowing (a wiring note)

The backend still exposes `POST /entertainment/threads/:id/start` — "persist
final options, then fetch+rewrite together" — and the renderer's store still
has the matching `startInternet` action (`chaptersStore.ts`), but the wizard's
Start button stopped calling it in commit `dc5fee1d`. In practice the
fetch+rewrite kick now arrives through the reader-cursor resume rule described
above (and through the footer's Process item). Keep this in mind when reading
the route's code comments, which still describe the older flow.
