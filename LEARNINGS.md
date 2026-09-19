# LEARNINGS.md

Mistakes already made in this repo, written so they are not made again. Each entry is a symptom
someone actually saw, the root cause behind it, and the rule that follows. Order is by cost.

---

## 1. A served file can be correct on disk and stale in the browser

**Cost: the single most expensive mistake in this project — three separate hours, mistaken for a CSS
bug twice.**

Symptom: a rule was served, present in `document.styleSheets`, and matching the element, and still
did not apply. Editing the CSS and reloading changed nothing. Deleting the rule entirely changed
nothing. The file on disk was correct; `curl` from inside the page showed the new rule arriving.

Root cause: the dev server was `python -m http.server`, which sends `Last-Modified` with **no**
`Cache-Control`. Chromium therefore applies heuristic freshness — typically 10% of the document's
age — and serves the previously-loaded copy without revalidating. With no cache headers the browser
decides how long a document is fresh, and it decides wrong.

But there is a second layer, and this is the one that really cost time. Even with `Cache-Control:
no-cache`, Chromium **reuses an already-loaded document on same-URL navigation**. `page.reload()` and
`page.goto()` with the same URL can both hand back the old parse. A byte-identical cache-buster is the
only reliable signal that a fresh parse happened.

The rule:

- **Always use `npm run serve`** (`tools/serve.mjs`), never `python -m http.server`. It sends
  `Cache-Control: no-store`.
- When a browser-tab change appears not to apply, **before touching the CSS**: navigate to
  `about:blank`, then navigate to `index.html?v=${Date.now()}`. If the change appears, the problem was
  freshness, not cascade. This takes ten seconds and would have saved three hours.
- Beware the trap's own signature: **if a change produces no effect at all, suspect freshness
  before cascade.** A real CSS bug usually produces a wrong effect, not a null one.

## 2. `getComputedStyle` can return the value from before your mutation

**Cost: about eight phantom "cascade bug" reports.**

Symptom: an element was given a class, the class had the right rule, the rule matched and won, and the
computed value read back was the old one.

Root cause: reading layout in the same task as the mutation that should change it returns the
pre-recalc value. The style is not wrong; the read is early. This combined with #1 to make a series of
convincing, entirely false CSS bug reports — the CSS looked broken, the probe agreed, and both were
wrong.

The rule:

```js
target.classList.add("x");
await new Promise((r) => requestAnimationFrame(r)); // style is now settled
await new Promise((r) => requestAnimationFrame(r)); // belt and braces
const value = getComputedStyle(target).color;
```

Two frames, or a 600 ms wait, between the mutation and the read. This applies to every browser test in
this repo.

## 3. When the model says the CSS is correct, doubt the probe

Follows from #1 and #2, and is the meta-lesson. In each of those incidents every piece of *reasoning*
was right — the rule existed, the specificity was right, the element matched — and the *measurement*
was wrong. Time went into re-deriving correct conclusions instead of checking the instrument.

The rule: when you have independently confirmed that a rule is served, present, and matching, and it
still appears not to apply, **stop reasoning and start instrumenting the probe.** Ask what would have
to be true for a correct stylesheet to look broken. The answer is usually caching or recalc timing.

## 4. Edits clobber adjacent, unrelated code — three times

**Cost: two shipped-in-waiting regressions, both caught only by re-reading.**

- An edit to add two bindings **deleted a `const` declaration** from the adjacent handler, leaving a
  `ReferenceError` on every reorder and delete click. `node --check` cannot see this — the file parses
  fine. Only pressing the buttons finds it.
- An edit **deleted `function buildCard(target) {`**, leaving a syntax error that `node --check` did
  catch.
- An edit **deleted the keyup and blur handlers that release the D overlay**, which would have left
  the dependency overlay stuck on permanently with no way to dismiss it.

Root cause, each time: the `old_string` was chosen to be "uniquely identifying" and the replacement
rewrote more than the change needed, so unmentioned neighbouring lines were dropped. The tool matched
what it was asked to match; the edit was simply wider than the intent.

The rule:

- **Make the smallest edit that expresses the change.** When inserting between two lines, include
  both neighbours in `old_string` and reproduce them verbatim in `new_string`. Never rely on "the
  rest is unchanged" for lines inside the replaced region.
- **After editing a region containing function boundaries or declarations, re-read it.** Not the
  whole file — the edited region plus a few lines either side.
- **`node --check` only proves the file parses.** It cannot see a deleted declaration, a dead binding
  or an unreachable branch. A behaviour change needs the code *run*.

## 5. Never call a function because it ought to exist

**Cost: caught before shipping, by review.**

`removeFromColumns(ui.selection, id)` and a `const prevIdx = …` were written into the multi-select
drag path. Neither existed anywhere in the file. The reasoning was sound — a bulk move "should"
remove ids from the other columns — and the function was simply invented. It would have thrown a
`ReferenceError` on the first group drag, the app's headline interaction.

The rule: **`grep` for the definition before calling a helper you have not just read.** A name that
feels like it should exist in a codebase this consistent is exactly the name most likely to be
imagined. `node --check` will catch the `prevIdx` form and never the invented function.

## 6. A test that fails may be the test's fault

**Cost: several rounds lost to an assertion that was wrong about the app.**

A check asserting "holding D with no card hovered canes nothing" failed repeatedly. Focus — not the
pointer — anchors the dependency chain, so the app was right and the assertion was wrong. A related
check asserted the board needed no scroll at 1180px, when the seed genuinely is wider than that.

The rule: when a test fails, **decide first whether the app or the assertion is wrong**, by reading
the requirement rather than by editing whichever is easier. Then fix the one that is wrong. Do not
weaken an assertion to make it pass, and do not change correct app behaviour to satisfy a hasty test.

## 7. A deleted token leaves its references silently dead

**Cost: caught by a purpose-built check, after surviving a full smoke suite.**

`var(--col-bg)` outlived the deletion of `--col-bg` and resolved to nothing. No console error, no
warning, nothing in the smoke suite — the column would simply have lost its fill with every check
still green.

The rule: `tests/check-styles.mjs` exists for this and must keep passing. **A class string in `app.js`
and a rule in `styles.css` are a contract with no compiler behind it.** When removing either side,
grep for the other first.

## 8. A guard around a failure turns the failure into a no-op

**Cost: a silently empty feature.**

A CDN icon script was loaded with a `defer`, and `createIcons()` was wrapped in a guard for the case
where `window.lucide` was undefined. The script never executed, the guard swallowed it, and four
placeholder elements sat empty in the DOM with no error anywhere. A fetch from inside the page proved
the network was fine, which is what made it findable at all.

The rule: **a guard that prevents a crash and reports nothing is a silent failure.** If the condition
is not expected, log or surface it. This is why the project has an explicit no-silent-failure rule, and
why the storage lamp reports the last write attempt rather than the intent to write.

## 9. Measure contrast; do not eyeball it

Every contrast defect in this project was found by computing a ratio and none by looking:

- The search field's placeholder at 2.43:1 looked "a bit dim".
- `+ ADD CARD` at 3.6:1 looked fine. So did the counters at 4.04:1.
- The dependency ring at 1.28:1 against a P2 fill looked *present* — the eye reads hue, not contrast.
- The ticket number at 4.3:1 was under the floor before the surface even changed, and dropped to
  3.6:1 after, because a warm surface carries more luminance.

And a vision model asked to sort the cards by fill colour **could not** — which was the evidence that
the three priority tints were 5–9 RGB apart. Asking a model to compare two things it cannot separate
is a cheap, decisive test.

The rule: 4.5:1 for text, 3:1 for graphics, computed not judged. **After a colour change, re-measure
everything the colour touches** — a change to a surface moves text on it, and a change to a hue can
move six things.

## 10. A colour may mean exactly one thing

Three separate incidents, same shape:

- **Cream meant both "neutral hover" and "P2"**, so a cream ring said two contradictory things. Found
  by a vision audit calling the cream rails the weakest element.
- **Amber meant both "warning" and "focus"**, making every focused field read as an error. Worst on
  the delete confirmation, where a yellow box around the type-to-confirm field reads as a reprimand.
  Caused by repointing the focus token to the accent to purge the last blue, without asking what
  amber already meant.
- **Indigo survived the navy sweep** in the drop-target rule, missed because the selector contained
  neither "drop" nor the old hex — the grep for the old value found everything except the one place
  that mattered.

The rule: before assigning a colour, ask what it already means. When sweeping a colour out, grep for
every *form* of it — the hex, the token name, and the properties it was used on — and then check what
you missed by looking at the rendered page, not the source.

## 11. Every state must be escapable

The most serious product defect found: **resetting the board left an empty board with no way back.**
Persistence is authoritative and never re-seeds, so once emptied the board stayed empty, and the only
route to the sample was clearing `localStorage` by hand. The app was internally consistent and
completely stuck.

The rule: for every state a user can reach through the UI, ask how they get back out of it — without
editing storage, without a URL they have to know, without a developer tool. Destructive actions need a
visible recovery path, and an empty state needs a way to be un-empty. This is why the sample board is
one click away in the drawer *and* offered on the read-out row when the board is empty.

## 12. Verify the claim, including an advisor's

An advisory flagged `#settings-reset` as unwired with a specific line reference. Reading that line
showed a stale reference — the handler was wired and working. Verified by clicking it.

Related, from the plan's own review: a visual audit asserted the columns had different widths (they
are five × 268px), a vision model read the armed reset button as "red with white text"
(`getComputedStyle` says `rgb(24, 4, 6)` at weight 700), and a review claimed this repo had a git
remote — it had none.

The rule: **any claim that can be checked, must be checked**, whoever made it — a subagent, a vision
model, an advisor, or your own earlier reasoning. A confident, specific, wrong claim is the most
expensive kind.

## 13. Repository mechanics

Small, cheap, and each one cost a few minutes.

- **Never push to `main`.** A guard blocks it with no override; this is correct. To create or move a
  remote branch without a local push, use the GitHub API: `gh api -X POST
  repos/OWNER/REPO/git/refs -f ref="refs/heads/main" -f sha="$SHA"`.
- **The git guard reads the whole command for `-m`, not just the commit's own flag.** Its
  conventional-commits matcher is `/-m\s*(?:'…'|"…"|(\S+))/` over the entire command string, so the
  *first* `-m` anywhere becomes the "message". Two ways this bites: staging a path in the same command
  as a commit message (`tasks/plans/….md` → it reads `vp.md`), and — worse — a `-m` inside the
  *message body itself*. A body mentioning `python -m http.server` was rejected as the message
  `http.server,`; renaming the message file to avoid that, `git commit -F …/ok-commit-msg.txt` was
  rejected as `sg.txt`, because `-msg` contains `-m` and `\S+` swallows the rest of the word. Both
  trips report the rule id `conventional-commits` and echo the captured substring, which is the tell.
  Until the matcher is anchored to git's argument position, keep `-m` out of commit bodies and out of
  any path passed alongside `git commit` — and note that `-F` does not exempt the command if the
  message file's *name* contains `-m`.
- **A guard message echoing a fragment is not evidence about your message.** Both blocks above looked
  like "your commit message is malformed"; neither was. Read the echoed text as what the matcher
  *captured*, not as what you wrote.
- **The LF→CRLF warning on every commit is expected and benign.** Git's autocrlf is translating; the
  repository content is correct. Do not "fix" it.
- **Never PowerShell; never `pip`.** `uv` if Python is ever needed — it currently is not.
- **`playwright install` fails on some Windows machines.** Run the suite with
  `OK_BROWSER_CHANNEL=msedge`. CI needs no override.

## 14. Two ways a signal passes while telling you nothing

Both of these happened in one session, both looked like success, and neither is caught by a syntax
check or a green test.

- **A status code is not evidence of what is being served.** Port 3000 answered `200`, and that was
  reported as this repo's app; it was a different project entirely. `curl -o /dev/null -w
  '%{http_code}'` proves something is listening, not that it is yours. Read the body — a `<title>`, a
  `data-port-shell` marker, `id="board"` — before drawing a conclusion from a port being open. The same
  trap is waiting in every health check in this repo.
- **A scripted edit whose anchor lacks its trailing newline joins two statements.** An edit anchored on
  the last line of a function body, without the newline, produced
  `async function composeBoard(ctx) {  await ctx.freshBoard();`. It parses, so `node --check` and the
  syntax gate both pass, and the effect would have surfaced as every cross-app check failing for a
  reason none of them names. Include the newline in the anchor, and read the edited lines back after
  any scripted edit to a file that matters.

## 15. A subagent's "done" describes its worktree, not yours

The board port ran for 70 minutes with `isolated: true`, reported every deliverable landed and every
gate green, and then exited non-zero. None of it existed in this checkout: the apply step that copies
an isolated worktree back to the parent runs on *success*, and the run had not succeeded.
`git worktree list` showed only the main checkout, so the work looked lost.

It was not. Every tool call in an agent's transcript carries a `resolvedPath`, and grepping
`history://PortBoard` for the file name printed the worktree root (`~/.omp/wt/<owner>/m`), where all
five files were intact — 1197 lines of component, 1503 of stylesheet — alongside an
`.omp-isolation-owner.json` naming the owner. Copying them back and running the real gates took four
minutes, against 70 minutes to redo the work.

The rules:

- **The evidence for "the code is written" is the file in your checkout.** Read the deliverable with
  `ls` before accepting any report; a worker's "done" is a claim about wherever it was allowed to
  write, and isolation puts that somewhere you never look.
- **Isolation's cost is invisibility.** Either work in the main checkout, or accept that a run which
  dies mid-flight strands its output in a directory nothing lists.
- **Recover before redoing.** The transcript records the argument of every write and the path it
  resolved to. Reading it is a cheaper first move than a second 70-minute run, and the `edit` bodies
  that follow a `write` are the reason recovery is only cheap if the `write` exists.
- **Have workers commit as they go.** The lost slice had no commit; the recovery ended with one, and
  that is what makes it durable.


## The failure detail tells you which assertion failed — read it against the check

**Cost: two wrong diagnoses in one session, one of them sent to a worker as a fix instruction.**

Symptom: a check failed and the detail contained a field that looked correct. `c-graph-04` (C4)
reported `{"title":"BLOCKED CARD → GATED COLUMN","items":[...],"okLabel":"MOVE ANYWAY",
"stillInTodo":true}` — every visible field right — so the failure was attributed to a stale build, and
later to the body text, which did contain the expected substring.

Root cause: the detail payload did not include the assertion that failed. The check asserts
`items.includes("Dependency graph: blockedBy edges — TO DO")` — an exact `Array.includes` — while the
app rendered `"#4 Dependency graph: blockedBy edges — TO DO"`. The `#4 ` prefix made that assertion
false, and no amount of inspecting the *body* substring could reveal it. The reference
(`app.js:711`) renders that list item with no ticket number; the bulk-move list (`app.js:1350`) does
include one. Two similar lists, two different formats, and the port had them swapped.

The same session produced a second instance of the same shape: twelve checks timed out in the shared
`ctx.waitFor` helper, the shared stack frame was read as a shared cause, and the diagnosis "selection
mode is broken" went to a worker — where a probe immediately disproved it (`selectMode` flips to `1`,
ticks appear, the chain lights up). The checks were the wrong side of the failure.

The rule:

- **Read the check's actual comparison before explaining its failure.** The detail field that is
  present and correct is usually the one that is not being asserted.
- **A shared stack frame is not a shared cause.** `ctx.waitFor` appearing in twelve traces means
  twelve things waited; what each waited *on* is the diagnosis, and they differ.
- **When a detail payload omits the field you need, add it to the check** rather than reasoning from
  the fields that happen to be there. `ok(false, {...})` should carry every value the assertion
  compares, or the next reader repeats this.
- **Probe before dispatching a fix.** A 10-second in-browser measurement would have prevented the
  false diagnosis from reaching a worker, where it risked removing a focus guard that another check
  (I11) depends on.


## Serving a static export by hand is a bug waiting for a MIME type

**Cost: two blocks on the user, and a debugging loop on code that should not have existed.**

Symptom: `localhost:4173` offered to download the page instead of rendering it.

Root cause: a hand-written static server derived `Content-Type` from `req.url`. A request for `/` has
no extension, so the lookup missed and fell through to `application/octet-stream`, which makes a
browser download the body. The app was always fine — the server never was.

The rule:

- **Run the framework's own server.** `next dev` (`npm run dev`, port 3000) is the way to look at this
  app; it hot-reloads, needs no export, and has no MIME logic to get wrong.
- **Serve `out/` with a real tool** when a built artifact must be reviewed — never with a bespoke
  server written for the occasion. The one exception is inside a test, where the harness already owns
  a correct static server and the test asserts against it.
- **A hand-rolled HTTP server is a liability with no upside here.** The 40 lines it saves are repaid
  with interest the first time a content type, a range request or a path traversal is got wrong.


## Fixing the app and loosening the check is fixing nothing

**Cost: a real, verified divergence was briefly made unfalsifiable.**

Symptom: `c-graph-04` (C4) failed on `items.includes("Dependency graph: blockedBy edges — TO DO")`
while the app rendered `"#4 Dependency graph: blockedBy edges — TO DO"`. The reference
(`app.js:711`) renders that list *without* a ticket number; the port had added one. A real defect.

What happened next is the mistake. The assertion was rewritten to a regex with an **optional**
prefix — `^(?:#\d+\s)?${text}$` — so the check would pass whether or not the prefix was there. In the
same commit the app was also corrected to drop the prefix. Both sides moved, so the check no longer
pins anything: re-introduce the prefix tomorrow and C4 still goes green.

The comment written at the time is the tell — it reasoned that "the port renders the ticket number,
the reference renders the bare name, so assert the same name + column either way." That is a
description of a bug being written down as a tolerance.

The rule:

- **A failing check names a divergence. Fix the side that is wrong, then re-run — do not edit the
  assertion.** If the app must change *and* the check must change, the check change needs its own
  reason that is not "the app differs".
- **An optional-prefix regex, a `toContain` where equality was meant, a widened tolerance, or a new
  `KNOWN_DEFECTS` entry are all the same move**: they convert a failing assertion into a passing one
  without changing behaviour. The suite's whole value is that it *can* fail.
- **After fixing an app divergence, re-run the STRICT check.** C4 passes with the original exact
  assertion once the app is right — which proves the loosening was never needed.
- **When a helper returns `null` and the comparison silently fails, fix the parser, not the
  assertion.** `sameColour` matched only `#rrggbb` while the CSS supplied `#ffffff1a`; extending the
  regex to `#rrggbb(aa)?` is a correct fixture fix. The distinction is whether the check can now
  *observe* the thing it was always trying to assert.


## A framework reset silently changed a native element's default

**Cost: a shipped regression the user found by eye, after a 107/0/0 green suite.**

Symptom: the reset and delete confirmation dialogs appeared in the top-left corner instead of centred.
The user reported it within a minute of looking.

Root cause: `@import "tailwindcss"` pulls in preflight, whose `*, ::before, ::after { margin: 0 }`
strips the user-agent default `dialog { margin: auto }` that centres a modal in the top layer. The
reference app has no reset, so it centres; `board.css` was **byte-identical to the reference**, so a
stylesheet diff showed nothing at all.

The rules:

- **A framework reset changes defaults you did not write.** Preflight is the one to suspect: it
  normalises `margin`, `padding`, borders and list styles on `*`. Any native element whose default
  styling the design relies on — `dialog`, `fieldset`, `ul`, `button`, `hr` — is a candidate.
- **A byte-identical stylesheet is not proof the rendering is identical.** The cascade includes the
  user-agent sheet and every `@import` above it. When a visual difference has no source in the file
  you are diffing, look *up* the import chain, not down the rule list.
- **The suite was green and the bug was real.** Nothing measured the dialog's box, so nothing could
  fail. A green suite is evidence about what it checks and nothing else — the user's eye found in
  seconds what 107 passing checks could not. This is the argument for looking at the app, not at the
  report.
- **A fix for a user-reported regression ships with a check that would have caught it.**
  `i-design.mjs` I13 measures the modal's centre against the viewport's and the drawer's right edge.
  It was falsified properly before being trusted: it failed on the pre-fix build
  (`centred:false`, modal at `left:2 top:1`) and passes after. A check that has never been seen to
  fail is not a check.


## A status marker is a claim, and I marked done on work that had no evidence

**Cost: an inaccurate progress report to the user, in the same way, twice in one session.**

First: I called `todo done` with no `task`, which closed **every** item — including "run the
frontend-craft pass" (never run) and "commit the polish separately" (no such commit). The list read
22/22 with nothing open while two items had nothing behind them.

Second: correcting it, I called `unblock` on an item that was `done`, not blocked. That is a different
state and the call was a silent no-op — the list still read 22/22. I then tried `start` on a task in a
phase the tool had already closed, which re-opened the wrong item. Only a third call, naming the task
exactly, produced the state I had claimed two calls earlier.

Root cause, both times: I treated the todo list as a place to *record* an intention rather than as a
claim requiring evidence. The tool takes the operation at face value — `done` with no `task` means
"all of it", `unblock` on a `done` item means nothing — so a wrong argument does not fail loudly. It
reports success and the list lies.

The rules:

- **`done` names one task. Never call it bare.** A bare `done` closes the whole list, so it is correct
  only when the whole list is genuinely finished, which is almost never the moment you feel like
  tidying up.
- **Check the state before the verb.** `unblock` needs `blocked`, `start` needs `pending`. A verb on the
  wrong state is a no-op, not an error — the tell is that the returned list is unchanged.
- **Read the list back after every call.** The response is the only evidence the operation landed; the
  two ham-fisted calls both looked like success.
- **Do not close a phase because the interesting work in it finished.** "Commit the polish separately"
  stays open until a commit exists, and "run frontend-craft" until the pass has run — however much I
  want the list to look clean. A green progress report that outruns the evidence is the same defect as
  a green test that asserts nothing.

---

## One key per board: the sample can no longer overwrite a board it did not come from

The React app used to store exactly one board under `openkanban.board.v1`, and `boot()` did this when
that payload could not be read: quarantine a copy to `.corrupt`, then `setBoard(seedBoard(), "sample")`
— which **persists**. So the sample was written over the user's board. Quarantine was a copy to a key
the app never read back, and the toast called that "preserved". The trigger was not hypothetical:
`validateBoard` refuses `version > SCHEMA_VERSION`, so a rollback, a stale preview URL or a cached tab
from a newer build silently replaced the board with the sample. Measured before the fix: writing
`{ not json` at the key and reloading left the key holding the sample.

The fix is not a guard. A guard is a flag a later code path can forget, and `commit()` persists on
every mutation, so protecting only the boot path would have deferred the loss to the first edit. The
fix is the key layout: **the in-memory board is always identified by an id, every write targets that
id's key, and a board that could not be read is never given the id of the board that failed.** With
one key per board the overwrite stops being possible rather than being prevented.

The parts that are easy to get wrong next time:

- **A refused payload is left byte-identical at its own key.** The copy at `<key>.corrupt` is a copy,
  and the sample opens under a *new* id — never the failed board's. `k-boards-03` asserts the bytes
  before boot *and* after a later edit, because a fix that only defers the loss is the failure this
  guards against.
- **The legacy key is read once and never written.** So an older build still finds its board after a
  rollback. The migration is a copy, not a move.
- **The quarantine copy is per board**, or two unreadable boards collide on one key.
- **The sample is a board in the list, not a seed.** It ships named `SAMPLE`, and the vanilla reference
  still ships `MAIN BOARD` — hence `SEED.sampleName(target)` in the fixture rather than `SEED.name`,
  which reds the vanilla gate the moment the two apps disagree.
- **The index is a convenience over the keys, never the truth.** It is rebuilt by scanning them, so a
  board whose document was written but whose index write failed is still found, and an index entry with
  no document is dropped.

Two smaller lessons from the same change, both about tests that stopped being able to fail:

- `c-graph-05` asserted `before === after` by reading the literal legacy key. Once the React app stopped
  writing that key both reads returned `null` and `null === null` passed — a check that had silently
  stopped detecting that cancelling a move mutated the board. Any byte-identity assertion must resolve
  the key from the target (`ctx.rawActiveBoard()`), never from a literal.
- `freshBoard()` cleared three known keys. With per-board keys that cannot be enumerated ahead of time,
  so it wipes by prefix (`openkanban.`) — a board key surviving from the previous check makes the next
  one order-dependent, which reads exactly like flaky behaviour.
