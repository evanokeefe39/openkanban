# OpenKanban

[![CI](https://github.com/evanokeefe39/openkanban/actions/workflows/ci.yml/badge.svg)](https://github.com/evanokeefe39/openkanban/actions/workflows/ci.yml)

A kanban board where dependencies are part of the data model: a card knows what blocks it, the board refuses to let you forget, and holding one key shows you the whole wiring.

I wanted a simple kanban with dependency tracking, could not find one in a few minutes of looking, and built this instead. The first working version took about an hour. It is now a React 19 / Next.js 16 app deployed as a static export — the original three-file vanilla version lives in git history on the `feat/mvp` branch.

![The board as it opens, populated with the sample cards it seeds itself with](docs/screenshots/board.webp)

## Dependencies are the point

Most boards treat a dependency as a note you write in a card. Here it is an edge in a graph, and the board's state is computed from it:

- **Edges are stored, blocked state is derived.** A card lists what blocks it. Whether it *is* blocked is worked out from the graph every render, so the badge and the wiring can never disagree.
- **A card is blocked while any blocker sits outside a DONE column.** Retiring a blocker is what unblocks its dependents — there is no second thing to remember to tick.
- **Gated columns warn before they let you through.** Moving a blocked card into a gated column explains exactly what is still unfinished and records an override — visible as an `OVERRIDE` chip, derived from the graph rather than stored as a flag.
- **Cycles are refused at the point of adding the edge**, with the path that would close, rather than at some later render where the cause is gone.
- **Hold `D` to see the wiring.** Every card in the hovered card's chain grows a border, and the card itself shows a row of numbered references — `← #4` blocked by 4, `→ #6` blocks 6. A **red candy cane** marks what the hovered card blocks; a **solid white line**, inset a step inside it, marks what blocks it. A card that does both carries both, which is the one case you can read at a glance. Release and the board goes quiet again.

![Holding D: a red candy cane on the cards the hovered card blocks, a solid white line on the cards that block it, and numbered references on each](docs/screenshots/dependencies.webp)

The graph is the reason the rest of the app is shaped the way it is. Card numbers exist so the wiring can be *spoken* ("4 blocks 6") instead of restated as titles, and they are handles rather than positions: assigned once, never reused.

## Everything else

- **Five lifecycle columns** by default, all editable: rename, reorder, add, delete, and flag each as a **gate** (warn on entry) or **done** (retiring work here unblocks dependents).
- **Cards** carry notes, priority (P0/P1/P2), due dates and labels, with an inline composer in each column.
- **Drag and drop** between and within columns — plus a `MOVE TO` row in the card drawer, which is the keyboard and touch path to the same `attemptMove` and therefore the same gate.
- **Search and filters** over title, notes and label, plus priority, blocked-only and due-date categories, with a live count of what is active.
- **View options** for density and six display toggles — card numbers, priority colour, labels, due dates, status chips, highlight-by-priority. They live in a separate storage key from the board, because they are a per-browser preference rather than part of the document.
- **Export and import** as JSON, with every repair itemised before anything is replaced.
- **Reset** — every card on the board, behind typing `delete` to arm the button. It is the one action with no undo, so it is the one action that makes you say the word.
- **A storage lamp** that says `SAVED` or explains why it could not, and quarantines an unreadable payload to `<key>.corrupt` instead of discarding it.
- **One file, one dependency: JetBrains Mono over a dark palette**, zero border radius, hard 1px rules, no shadows.

| Filters | Settings and view options |
| --- | --- |
| ![The filter pane open under its icon in the toolbar](docs/screenshots/filters.webp) | ![The settings sidebar, with lifecycle flags and view options](docs/screenshots/settings.webp) |

| Reset, gated on a typed word | Narrow viewport |
| --- | --- |
| ![The reset dialog, with delete typed into the confirmation field](docs/screenshots/reset.webp) | ![The board at a narrow viewport](docs/screenshots/mobile.png) |

## Running it

The app is a Next.js static export. For development:

```sh
npm install
npm run dev      # next dev
```

For a production build and a local look at what deploys:

```sh
npm run build    # static export -> out/, plus the TypeScript check
npm run serve    # http://127.0.0.1:8080, no-cache
```

Use `npm run serve` rather than `python -m http.server`. Python's server sends `Last-Modified` with no `Cache-Control`, so Chromium applies heuristic freshness and will happily serve you the *previous* document after an edit — which looks exactly like a CSS bug and is not one. [`tools/serve.mjs`](tools/serve.mjs) sends `Cache-Control: no-store` and costs nothing to run. The whole story is in [`LEARNINGS.md`](LEARNINGS.md).

### Keyboard

| Key | Does |
| --- | --- |
| Hold `D` | Show the dependency overlay: borders plus `← #n` / `→ #n` references, shaded by direction |
| `C` | Add a card to the first column |
| Hold `Ctrl` | Reveal the card ticks. Click cards to pick them, then drag any one of them to move the group |
| `Enter` | Add the card you are composing (in the inline composer or the drawer's label/blocker fields) |
| `Escape` | Close the popover, a dialog, or a drawer |

The `MOVE TO` row in the card drawer is the keyboard path for moving a card, and it goes through the same gate as dragging. So does a group drag: a batch that contains blocked cards warns once, naming each of them, before it moves.

## Where your data lives

The app keeps a **collection** of boards, one key per board, because with a single key any write to "the board" is a write to the only board there is — which is how an unreadable payload once came to be replaced by the sample:

| Key | Holds | Notes |
| --- | --- | --- |
| `openkanban.boards.v1` | The index: `{version, activeId, ids}` | Which boards exist and which is open. Rebuildable by scanning the keys, so losing it loses only the order |
| `openkanban.boards.v1.<id>` | One board document | The unit export writes and import replaces |
| `openkanban.boards.v1.<id>.corrupt` | That board's unparseable payload | Per board, so two unreadable boards cannot collide |
| `openkanban.board.v1` | The legacy single-board key | Read once as a migration; a board stored there by the older build is adopted into the collection and the key is left untouched |
| `openkanban.view.v1` | Density and the six display toggles | Per-browser preference; importing a board must not rewrite it |

A stored board is validated on load and repaired where it can be (a document saved without card numbers gets numbers in creation order, and says so). Anything unreadable is quarantined and a fresh sample opens under a *new* id, so a bad payload costs you a warning, not a silent wipe of the good copy.

Its guarantees, all asserted in `tests/behaviour/k-boards.mjs`:

- a board that cannot be read is left **byte-identical** at its own key, before and after any later edit — a copy goes to `<key>.corrupt` and a sample opens under a *new* id, so the failed payload is never given the sample's id and never overwritten;
- a board from a **newer schema** (an older build after a rollback) is refused the same way rather than destroyed;
- a board saved by an older build under `openkanban.board.v1` is **adopted** into the collection on first load, and that key is left untouched — so opening after an upgrade still finds it;
- a corrupt index is rebuilt from the board keys themselves.

One consequence worth knowing: the shipped sample is a **board in the list** named `SAMPLE`, not a seed that overwrites whatever is stored.

## Tests and CI

The gate drives the real built export in a real browser instead of trusting a green build — [`tests/behaviour/`](tests/behaviour/) serves `out/` over http, opens it with Playwright, and checks the behaviour the app would be broken without: cold start and seed, corrupt-payload quarantine and repair, persistence, the dependency gate and overrides, cycle refusal, the drag gesture, filters and view options, export/import, reset, multi-board handling, and the page logging no errors while any of that happens.

```sh
npm ci
npx playwright install chromium
npm run behaviour # the gate: builds, then drives every check against the ledger
npm run check     # syntax check, plus every var() in the CSS must resolve
npm run lib:test  # Vitest: the pure model + the component layer
```

`npm run check` also runs [`tests/check-styles.mjs`](tests/check-styles.mjs), which exists because of a real defect: deleting a CSS token leaves every `var(--that-token)` silently resolving to nothing — no console error, no failed check, just an element with no background. It cross-references every `var(--x)` use against the definitions and fails the build instead.

If the pinned browser download is unavailable (it can be, behind a proxy), any installed Chromium-family browser will do:

```bash
OK_BROWSER_CHANNEL=msedge npm run behaviour
```

The suite keeps a **coverage ledger** ([`inventory.mjs`](tests/behaviour/inventory.mjs)): every behaviour the app must have is an id, at least one check must cover it, and every one of the pre-port suite's checks must have a live successor. An uncovered feature fails the run, so "nothing was dropped" is asserted rather than promised. Measured defects the app actually has may be carried in `KNOWN_DEFECTS` — printed with their reasons on every run, never hidden behind a loosened assertion.

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs the Vitest suite and the behaviour gate on every pull request and on every push to `main`, and uploads screenshots and reports to `tests/.artifacts/` when the gate fails. Playwright is a dev dependency for the test harness.

## Deploying

The app is a Next.js static export. On Vercel: import the repository; the framework preset is pinned to **Next.js** in `package.json`, so detection cannot guess. The build emits `out/` and Vercel serves it. [`vercel.json`](vercel.json) adds the two things worth adding — `Cache-Control: max-age=0, must-revalidate` so a deploy takes effect on the next load instead of leaving someone on last week's markup, and `nosniff` / `no-referrer` / `DENY` frame headers.

## Roadmap

Undo/redo, an `npx` package that puts a local server, a CLI and an MCP server in front of the same board so an agent can read and write it rather than only render it — plus what was considered and rejected, and why. See [`ROADMAP.md`](ROADMAP.md).

## Design notes

The look is lifted from a sibling project's design language: a dark instrument panel, JetBrains Mono throughout, 1px rules as the only source of separation, and zero border radius.

The board is two surfaces and one hover. The **page** (`#0a0608`) carries everything that is part of the board: the toolbar, the read-out row, the columns and the filter pane, so those are drawn by their 1px rules rather than by a change of plane. The **card** (`#1f1819`) is warm against it. Only genuinely floating chrome takes a third: **ink** (`#00161c`) for the modals and the toasts, which appear *over* the board rather than beside it. Every hover across the app is one translucent white lift rather than a fourth colour, so a button looks like the same button wherever it is placed.

Colour is rationed, and this is the rule that keeps it legible: **colour is reserved for the priority rail, the blocked/override/due chips, the filter badge, and the dependency overlay** — everything else is ivory or a grey. Where two colour systems have to share a surface they are separated by a dark step rather than a louder hue, because the contrast of a border is set by what is immediately behind it.

The dependency overlay is the case that forced the rule. Its two directions are a **candy cane** — two reds alternating, 4.4:1 apart from each other — and a **solid white line**. The striping is the point: a 2px edge made of two colours that differ from *each other* reads as an edge on any fill the priority tint can produce, where a single-colour ring depends on one hue standing out from whatever happens to be behind it. While a card carries either, the tint keeps its fill and gives up its border, so two border systems never compete for the same edge.

That is a measured decision, not a taste one. The white line is 15.4:1 against a plain card and 17.7:1 against the page; the cane's stripes are 4.4:1 against each other; and the numbered references sit on their own dark backing strip rather than on the card fill, which holds them at 5.8:1 or better over every tint. An earlier cut of this overlay was a single 1px indigo ring, which measured 1.28:1 against the palest tint — the kind of number that only turns up when you compute it rather than look at it.

The build's specification, verification log and the numbers behind claims like that live in [`tasks/plans/openkanban-mvp.md`](tasks/plans/openkanban-mvp.md).

## Repository layout

```
app/                      the React app: pages and components
components/               the UI tree: board, shell, overlays
lib/                      the pure model, framework-free TypeScript
stores/                   state and the single commit path
styles/                   one sheet per surface, tokens in 01-tokens.css
tests/behaviour/          the behaviour suite, driven through a real browser
tests/check-styles.mjs    fails the build if a var() has no definition
tools/serve.mjs           the no-cache static server
docs/screenshots/         the images in this README
tasks/plans/              specification, decisions and verification log
.github/workflows/ci.yml  runs the gate on every pull request
vercel.json               cache and security headers for the deploy
```

## Working on it

If you are changing the code rather than reading it, start with [`AGENTS.md`](AGENTS.md) — it carries the conventions, the one rule that shapes the data model, and the verification bar.

| Document | Purpose |
| --- | --- |
| [`AGENTS.md`](AGENTS.md) | How to work here: architecture, conventions, the commands, the verification bar |
| [`ROADMAP.md`](ROADMAP.md) | What is planned, and what was considered and rejected |
| [`ISSUES.md`](ISSUES.md) | Bugs found and fixed, and the limitations that remain |
| [`LEARNINGS.md`](LEARNINGS.md) | Mistakes already made here, so they are not made twice |
| [`WATCHDOG.md`](WATCHDOG.md) | Reviewer guidance: what to be suspicious of in this codebase |

## How this was built

One session, one model (`deepseek-v4-flash`), with the transcript as the source of these numbers — parsed with DuckDB out of the harness's session log, counting only the model's own responses (a "turn" is a message from me, and one turn can be dozens of responses once the agent starts running tools). Measured at the commit that last touched this section; the session ran on past it, so these are a snapshot rather than a final total.

The query, if you want to reproduce it against your own session log:

```sql
SELECT count(*) AS responses,
       sum(message.usage.input)::BIGINT  AS input_tokens,
       sum(message.usage.output)::BIGINT AS output_tokens,
       sum(message.usage.cacheRead)::BIGINT AS cache_reads,
       sum(message.usage.totalTokens)::BIGINT AS total_tokens,
       round(sum(message.usage.cost.total), 2) AS cost_usd
FROM read_json_auto('<session>.jsonl', format = 'newline_delimited', union_by_name = true)
WHERE type = 'message' AND message.role = 'assistant';
```

| | |
| --- | --- |
| Wall clock | 162 minutes |
| Turns (mine) | 24 |
| Model responses | 424 |
| Tool calls | 617 |
| Input tokens | 1,552,941 |
| Output tokens | 619,273 |
| Reasoning tokens | 292,540 |
| Cache reads | 78,054,272 |
| Total tokens | 80,226,486 |
| Cost | $1.68 |
| App code | 3,829 lines across `index.html`, `styles.css`, `app.js` (the original vanilla build, since deleted — see `feat/mvp`) |
| Test harness and config | 486 lines |

Roughly a cent a minute, and about four hundredths of a cent per line that survived to the end — of which the majority was spent on the parts you cannot see in a screenshot: the derived-blocked model, the validation and repair path, and measuring contrast rather than guessing at it.

## Licence

The code is licensed under the [PolyForm Noncommercial License 1.0.0](LICENSE.md). You are free to
read it, run it, learn from it, and use it for anything noncommercial — personal projects, study,
hobby work, teaching, research, and use by charities, schools and public bodies. Commercial use is
not permitted. That includes running it as a paid product, bundling it into something you sell, or
selling the development itself.

If you want to use it commercially, ask.
