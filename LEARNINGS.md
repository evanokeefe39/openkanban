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
