/**
 * Cards: creating, editing, deleting, and how a card reads on the board.
 *
 * Owns features B1–B15 (see `inventory.mjs`):
 *   B1  the inline composer adds a numbered, persisted card
 *   B2  a blank title is refused and nothing is created
 *   B3  a title is trimmed and its internal whitespace collapsed
 *   B4  C opens the composer in the first column, focused; Escape closes it
 *   B5  a second add keeps the composer open and focused, text preserved
 *   B6  the drawer opens from the card and shows the whole card
 *   B7  drawer edits persist: title, notes, priority, due, labels
 *   B8  a blank title in the drawer is refused, previous title kept
 *   B9  deleting a card drops its edges and reports how many links went
 *   B10 a long title clamps and a long note scrolls, with no layout shift
 *   B11 a card with no labels, notes or links collapses its meta row
 *   B12 ticket numbers are issued once and never reused
 *   B13 due chips read TODAY / OVERDUE / muted, and never red when done
 *   B14 closing the drawer flushes a pending field edit
 *   B15 Escape and backdrop close the drawer, and focus returns to the card
 *
 * Where the behaviour lives: `app.js` — `addCard()`, `buildAddForm()`,
 * `buildCard()`, `openCard()`, `fillCardDialog()`, `flushCardFields()`,
 * `updateCard()`, `deleteCard()`, `stampDateTime()`, `daysUntil()`,
 * `bindBackdropClose()`. `SEED` and `KNOWN` in `dom.mjs` name the sample cards
 * worth using (e.g. `KNOWN.twoBlockers` is #6, blocked by two cards).
 *
 * Rules: a check sets up its own state (never relies on the previous check);
 * assert the observable outcome — an attribute, a computed value, a toast, the
 * stored document — never an implementation detail; read computed style only
 * after `ctx.waitFrames()`.
 */
import { ok } from "./harness.mjs";
import { sel, SEED, KNOWN } from "./dom.mjs";

/** Local-calendar `YYYY-MM-DD` offset by `days` from today, evaluated in the page. */
const isoDate = (ctx, days) =>
  ctx.page.evaluate((offset) => {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
      d.getDate()
    ).padStart(2, "0")}`;
  }, days);

/** Open a card, write one drawer field, close — the whole user path. */
async function editViaDrawer(ctx, cardId, field, value) {
  await ctx.openDrawer(cardId);
  await ctx.page.fill(field, value);
  await ctx.closeDrawer();
}

/** Delete a card through the drawer, answering the confirm gate. */
async function deleteViaDrawer(ctx, cardId, okLabel) {
  await ctx.openDrawer(cardId);
  await ctx.page.click(sel.drawerDelete);
  const answer = await ctx.confirm(okLabel);
  if (answer.ok === false) return answer;
  await ctx.page.waitForFunction(
    (id) => !document.querySelector(`.card[data-card-id="${id}"]`),
    cardId
  );
  return answer;
}

/** The computed colour of a chip, resolved through getComputedStyle. */
const chipColor = (ctx, chipSel) => ctx.style(chipSel, "color");

export default {
  id: "b-cards",
  title: "cards: compose, edit, delete, read",
  checks: [
    // ---------------------------------------------------------------- B1 ----
    {
      id: "b-cards-01",
      feature: "B1",
      name: "the inline composer adds a numbered, persisted card",
      run: async (ctx) => {
        await ctx.freshBoard();
        await ctx.page.click(sel.addButton("col-backlog"));
        await ctx.page.waitForSelector(sel.addForm);
        await ctx.page.fill(sel.addFormInput, "Fresh card");
        await ctx.press("Enter");
        await ctx.waitFor(() => document.querySelector("#board .card .card-title") !== null);
        // the new card is the first card in the first column, numbered past the seed
        const dom = await ctx.page.evaluate(() => {
          const column = document.querySelector('.column[data-column-id="col-backlog"]');
          const card = column.querySelector(".card:last-of-type");
          return {
            num: card?.querySelector(".card-num")?.textContent,
            title: card?.querySelector(".card-title")?.textContent,
            count: column.querySelectorAll(".card").length,
          };
        });
        const board = await ctx.storedBoard();
        const column = board.columns.find((c) => c.id === "col-backlog");
        const newId = column.cardIds[column.cardIds.length - 1];
        const stored = board.cards[newId];
        return ok(
          dom.num === "#12" &&
            dom.title === "Fresh card" &&
            dom.count === 3 &&
            stored?.number === 12 &&
            stored?.title === "Fresh card" &&
            board.nextNumber === 13,
          { dom, storedNumber: stored?.number, storedTitle: stored?.title, nextNumber: board.nextNumber }
        );
      },
    },

    // ---------------------------------------------------------------- B2 ----
    {
      id: "b-cards-02",
      feature: "B2",
      name: "a blank title is refused with a warn toast and nothing is created",
      run: async (ctx) => {
        await ctx.freshBoard();
        await ctx.page.click(sel.addButton("col-backlog"));
        await ctx.page.waitForSelector(sel.addForm);
        await ctx.page.fill(sel.addFormInput, "   ");
        await ctx.press("Enter");
        const toasts = await ctx.toasts();
        const board = await ctx.storedBoard();
        const backlogCount = board.columns.find((c) => c.id === "col-backlog").cardIds.length;
        const domCards = await ctx.count(sel.cards);
        return ok(
          toasts.some((t) => t.kind === "warn" && /A TITLE IS REQUIRED/.test(t.text)) &&
            backlogCount === 2 &&
            domCards === 11 &&
            board.nextNumber === 12,
          { toasts, backlogCount, domCards, nextNumber: board.nextNumber }
        );
      },
    },

    // ---------------------------------------------------------------- B3 ----
    {
      id: "b-cards-03",
      feature: "B3",
      name: "a title is trimmed and its internal whitespace collapsed",
      run: async (ctx) => {
        await ctx.freshBoard();
        await ctx.page.click(sel.addButton("col-backlog"));
        await ctx.page.waitForSelector(sel.addForm);
        await ctx.page.fill(sel.addFormInput, "  two    words\tand   more  ");
        await ctx.press("Enter");
        await ctx.waitFor(
          () =>
            [...document.querySelectorAll(".card-title")].some(
              (n) => n.textContent === "two words and more"
            )
        );
        const domTitle = await ctx.page.evaluate(
          () =>
            [...document.querySelectorAll(".card-title")].find(
              (n) => n.textContent === "two words and more"
            )?.textContent
        );
        const board = await ctx.storedBoard();
        const newId = board.columns.find((c) => c.id === "col-backlog").cardIds.at(-1);
        return ok(domTitle === "two words and more" && board.cards[newId]?.title === domTitle, {
          domTitle,
          storedTitle: board.cards[newId]?.title,
        });
      },
    },

    // ---------------------------------------------------------------- B4 ----
    {
      id: "b-cards-04",
      feature: "B4",
      name: "C opens the composer in the first column, focused; Escape closes it",
      run: async (ctx) => {
        await ctx.freshBoard();
        await ctx.press("c");
        await ctx.waitFor(() => document.querySelector("#board .add-form") !== null);
        const opened = await ctx.page.evaluate(() => {
          const form = document.querySelector("#board .add-form");
          return {
            column: form?.closest(".column")?.dataset.columnId,
            focused: document.activeElement?.tagName,
            value: document.activeElement?.value,
          };
        });
        await ctx.press("Escape");
        await ctx.waitFor(() => document.querySelector("#board .add-form") === null);
        const cardCount = await ctx.count(sel.cards);
        const stored = await ctx.storedBoard();
        return ok(
          opened.column === "col-backlog" &&
            opened.focused === "TEXTAREA" &&
            opened.value === "" &&
            cardCount === 11 &&
            stored.nextNumber === 12,
          { opened, cardCount, nextNumber: stored.nextNumber }
        );
      },
    },

    // ---------------------------------------------------------------- B5 ----
    {
      id: "b-cards-05",
      feature: "B5",
      name: "a second add keeps the composer open, focused and empty; the first card keeps its text",
      run: async (ctx) => {
        await ctx.freshBoard();
        await ctx.page.click(sel.addButton("col-progress"));
        await ctx.page.waitForSelector(sel.addForm);
        await ctx.page.fill(sel.addFormInput, "first card");
        await ctx.press("Enter");
        await ctx.waitFor(
          () =>
            [...document.querySelectorAll(".card-title")].some(
              (n) => n.textContent === "first card"
            ) && document.querySelector("#board .add-form textarea") !== null
        );
        const after = await ctx.page.evaluate(() => {
          const textarea = document.querySelector("#board .add-form textarea");
          return {
            formColumn: textarea?.closest(".column")?.dataset.columnId,
            focused: document.activeElement === textarea,
            value: textarea?.value,
          };
        });
        // type the second card into the surviving composer and confirm it lands too
        await ctx.page.fill(sel.addFormInput, "second card");
        await ctx.press("Enter");
        await ctx.waitFor(
          () =>
            [...document.querySelectorAll(".card-title")].some(
              (n) => n.textContent === "second card"
            )
        );
        const board = await ctx.storedBoard();
        const titles = board.columns
          .find((c) => c.id === "col-progress")
          .cardIds.map((id) => board.cards[id]?.title);
        return ok(
          after.formColumn === "col-progress" &&
            after.focused === true &&
            after.value === "" &&
            titles.includes("first card") &&
            titles.includes("second card"),
          { after, progressTitles: titles.slice(-3) }
        );
      },
    },

    // ---------------------------------------------------------------- B6 ----
    {
      id: "b-cards-06",
      feature: "B6",
      name: "the drawer opens from the card and shows the whole card",
      run: async (ctx) => {
        await ctx.freshBoard();
        const id = KNOWN.twoBlockers; // #6, blocked by two cards
        await ctx.openDrawer(id);
        const columnName = (await ctx.text(sel.columnName("col-todo"))).trim();
        const want = await ctx.storedCard(id);
        const got = await ctx.page.evaluate(() => {
          const q = (s) => document.querySelector(s);
          return {
            kicker: q("#card-kicker")?.textContent,
            title: q("#card-title")?.value,
            notes: q("#card-notes")?.value,
            priority: q('#card-priority button[aria-pressed="true"]')?.dataset.priority,
            due: q("#card-due")?.value,
            labels: [...q("#card-labels").querySelectorAll("[data-remove-label]")].map(
              (n) => n.dataset.removeLabel
            ),
            blockers: [...q("#card-blockers").querySelectorAll("[data-remove-blocker]")].map(
              (n) => n.dataset.removeBlocker
            ),
            blockersLabel: q("#card-blockers-label")?.textContent,
            moveTargets: [...q("#card-move").querySelectorAll("button[data-move-to]")].map(
              (n) => n.dataset.moveTo
            ),
            moveCount: q("#card-move").querySelectorAll("button[data-move-to]").length,
            meta: q("#card-meta")?.textContent,
          };
        });
        await ctx.closeDrawer();
        const metaOk = /^CREATED .+ · UPDATED .+/.test(got.meta || "");
        return ok(
          got.kicker === `CARD #6 / ${columnName}` &&
            got.title === want.title &&
            got.notes === want.notes &&
            got.priority === String(want.priority) &&
            got.due === want.due &&
            JSON.stringify(got.labels) === JSON.stringify(want.labels) &&
            got.blockers.length === 2 &&
            /2 OF 2 UNFINISHED/.test(got.blockersLabel) &&
            got.moveCount === 5 &&
            got.moveTargets.includes("col-done") &&
            metaOk,
          { got, want, columnName, metaOk }
        );
      },
    },

    // ---------------------------------------------------------------- B7 ----
    {
      id: "b-cards-07",
      feature: "B7",
      name: "drawer edits persist: title, notes, priority, due + clear, label add/remove",
      run: async (ctx) => {
        await ctx.freshBoard();
        const id = KNOWN.unblockedBatchMember; // #4, no labels, unblocked
        const due = await isoDate(ctx, 10);
        const steps = [];
        const step = (n) => (steps.push(n), n);
        try {
          await ctx.openDrawer(id);
          // clicks before text edits: a text field's blur commits a re-render on
          // mousedown, which rebuilds the drawer's buttons between mousedown and
          // mouseup and eats the click (reported separately as an app finding)
          step("priority");
          await ctx.page.click(sel.drawerPriorityOption("2"));
          await ctx.waitFor(
            () =>
              document.querySelector('#card-priority button[aria-pressed="true"]')?.dataset
                .priority === "2"
          );
          step("due");
          await ctx.page.fill(sel.drawerDue, due);
          // #card-close is static markup, so the blur-render under this click is safe
          step("close 1");
          await ctx.closeDrawer();
          step("read 1");
          const persistedCard = await ctx.storedCard(id);
          const persisted =
            persistedCard.priority === 2 && persistedCard.due === due;
          step("reopen 2");
          await ctx.openDrawer(id);
          // label add: the label input has no change handler, so no blur-render races it
          step("label input");
          await ctx.page.fill(sel.drawerLabelInput, "port");
          step("label add");
          await ctx.page.click(sel.drawerLabelAdd);
          await ctx.waitFor(
            () => !!document.querySelector('#card-labels [data-remove-label="PORT"]')
          );
          step("due clear");
          await ctx.page.click(sel.drawerDueClear);
          await ctx.waitFrames();
          step("close 2");
          await ctx.closeDrawer();
          step("read 2");
          let stored = await ctx.storedCard(id);
          // the app title-cases labels into uppercase chips
          const afterAdd =
            stored.due === "" &&
            stored.labels.includes("PORT") &&
            stored.labels.length === 2; // seed CORE + the new PORT
          if (!afterAdd) return ok(false, { steps, read2: stored });
          // text edits last: title and notes are flushed on close (no further clicks)
          step("text edits");
          await ctx.openDrawer(id);
          await ctx.page.fill(sel.drawerTitle, "Renamed card");
          await ctx.page.fill(sel.drawerNotes, "Some notes about the port");
          step("close 3");
          await ctx.closeDrawer();
          step("read 3");
          stored = await ctx.storedCard(id);
          const textPersisted =
            stored.title === "Renamed card" && stored.notes === "Some notes about the port";
          // label remove, in a fourth pass: open, click the chip, close
          step("reopen 4");
          await ctx.openDrawer(id);
          step("label remove");
          await ctx.page.click(sel.drawerLabelRemove("PORT"));
          step("close 4");
          await ctx.closeDrawer();
          step("read 4");
          stored = await ctx.storedCard(id);
          return ok(
            persisted && afterAdd && textPersisted && stored.labels.length === 1,
            {
              persisted,
              afterAdd,
              textPersisted,
              steps,
              final: { labels: stored.labels, title: stored.title },
            }
          );
        } catch (error) {
          return ok(false, { steps, error: String(error).slice(0, 300) });
        }
      },
    },

    // ---------------------------------------------------------------- B8 ----
    {
      id: "b-cards-08",
      feature: "B8",
      name: "a blank title in the drawer is refused and the previous title kept",
      run: async (ctx) => {
        await ctx.freshBoard();
        const id = KNOWN.root;
        const before = (await ctx.storedCard(id)).title;
        await ctx.openDrawer(id);
        await ctx.page.fill(sel.drawerTitle, "   ");
        await ctx.closeDrawer();
        const toasts = await ctx.toasts();
        const stored = (await ctx.storedCard(id)).title;
        const domTitle = await ctx.text(sel.cardTitle(id));
        return ok(
          toasts.some((t) => t.kind === "warn" && /A CARD NEEDS A TITLE/.test(t.text)) &&
            stored === before &&
            domTitle.trim() === before,
          { toasts, before, stored, domTitle }
        );
      },
    },

    // ---------------------------------------------------------------- B9 ----
    {
      id: "b-cards-09",
      feature: "B9",
      name: "deleting a card drops its edges, the dependents' edges, and reports the count",
      run: async (ctx) => {
        await ctx.freshBoard();
        const id = KNOWN.root; // #1 blocks c-store, c-drawer and c-drag
        const dependents = ["c-store", "c-drawer", "c-drag"];
        const deleted = await deleteViaDrawer(ctx, id, "DELETE");
        if (deleted.ok === false) return ok(false, { confirm: deleted.detail });
        const toasts = await ctx.toasts();
        const board = await ctx.storedBoard();
        const gone = board.cards[id] === undefined;
        const edges = Object.fromEntries(
          dependents.map((d) => [d, board.cards[d]?.blockedBy ?? null])
        );
        const cleaned = dependents.every((d) => board.cards[d] && board.cards[d].blockedBy.length === 0);
        return ok(
          gone &&
            cleaned &&
            toasts.some((t) => /CARD DELETED — REMOVED 3 DEPENDENT LINK\(S\)/.test(t.text)),
          { gone, edges, deleteToasts: toasts.filter((t) => /DELETED/.test(t.text)) }
        );
      },
    },

    // --------------------------------------------------------------- B10 ----
    {
      id: "b-cards-10",
      feature: "B10",
      name: "a long title clamps and a long note scrolls, with no board layout shift",
      run: async (ctx) => {
        await ctx.freshBoard();
        const id = KNOWN.bothWays; // #3, in col-progress
        const bodyBox = () => ctx.page.locator(sel.columnBody("col-progress")).boundingBox();
        const before = await bodyBox();
        await ctx.openDrawer(id);
        await ctx.page.fill(sel.drawerTitle, "X".repeat(240));
        await ctx.page.fill(sel.drawerNotes, "line\n".repeat(60));
        const notesScroll = await ctx.page.evaluate(() => {
          const notes = document.querySelector("#card-notes");
          return { scrollHeight: notes.scrollHeight, clientHeight: notes.clientHeight };
        });
        await ctx.closeDrawer();
        await ctx.waitFrames();
        const after = await bodyBox();
        const cardReads = await ctx.page.evaluate((cardId) => {
          const title = document.querySelector(
            `.card[data-card-id="${cardId}"] .card-title`
          );
          return {
            scrollWidth: title.scrollWidth,
            clientWidth: title.clientWidth,
            text: title.textContent.length,
          };
        }, id);
        return ok(
          notesScroll.scrollHeight > notesScroll.clientHeight &&
            cardReads.scrollWidth <= cardReads.clientWidth + 1 &&
            cardReads.text === 240 &&
            before.height === after.height &&
            before.width === after.width,
          { notesScroll, cardReads, columnBefore: before.height, columnAfter: after.height }
        );
      },
    },

    // --------------------------------------------------------------- B11 ----
    {
      id: "b-cards-11",
      feature: "B11",
      name: "a card with no labels, notes or links collapses its meta row — no empty chips",
      run: async (ctx) => {
        await ctx.freshBoard();
        // a freshly composed card has no notes, labels, due, links or priority
        await ctx.page.click(sel.addButton("col-backlog"));
        await ctx.page.waitForSelector(sel.addForm);
        await ctx.page.fill(sel.addFormInput, "Bare card");
        await ctx.press("Enter");
        await ctx.waitFor(
          () =>
            [...document.querySelectorAll(".card-title")].some(
              (n) => n.textContent === "Bare card"
            )
        );
        await ctx.waitFrames();
        const reads = await ctx.page.evaluate(() => {
          for (const card of document.querySelectorAll("#board .card")) {
            if (card.querySelector(".card-title")?.textContent !== "Bare card") continue;
            return {
              chips: card.querySelectorAll(".card-meta .chip").length,
              metaChildren: card.querySelector(".card-meta").children.length,
              refs: card.querySelectorAll(".card-refs").length,
            };
          }
          return null;
        });
        return ok(reads && reads.chips === 0 && reads.metaChildren === 0 && reads.refs === 0, {
          reads,
        });
      },
    },

    // --------------------------------------------------------------- B12 ----
    {
      id: "b-cards-12",
      feature: "B12",
      name: "ticket numbers are issued once, never reused: the next card takes #12 after #11 is deleted",
      run: async (ctx) => {
        await ctx.freshBoard();
        // delete the highest-numbered seed card, #11
        const deleted = await deleteViaDrawer(ctx, KNOWN.done, "DELETE");
        if (deleted.ok === false) return ok(false, { confirm: deleted.detail });
        await ctx.page.click(sel.addButton("col-backlog"));
        await ctx.page.waitForSelector(sel.addForm);
        await ctx.page.fill(sel.addFormInput, "Recycled check");
        await ctx.press("Enter");
        await ctx.waitFor(
          () =>
            [...document.querySelectorAll(".card-num")].some((n) => n.textContent === "#12")
        );
        const board = await ctx.storedBoard();
        const newId = board.columns.find((c) => c.id === "col-backlog").cardIds.at(-1);
        const stored = board.cards[newId];
        const elevenGone = board.cards[KNOWN.done] === undefined;
        return ok(
          elevenGone &&
            stored.number === 12 &&
            stored.title === "Recycled check" &&
            board.nextNumber === 13,
          { elevenGone, newNumber: stored?.number, nextNumber: board.nextNumber }
        );
      },
    },

    // --------------------------------------------------------------- B13 ----
    {
      id: "b-cards-13",
      feature: "B13",
      name: "a due card reads TODAY in cyan and OVERDUE in red while unfinished",
      run: async (ctx) => {
        await ctx.freshBoard();
        const id = KNOWN.unblockedBatchMember; // #4, col-todo — not a done column
        const today = await isoDate(ctx, 0);
        await editViaDrawer(ctx, id, sel.drawerDue, today);
        await ctx.waitFrames();
        const todayColor = await chipColor(ctx, sel.card(id) + " .chip.due-today");
        const todayText = await ctx.page.evaluate(
          () =>
            document.querySelector('.card[data-card-id="c-graph"] .card-meta .chip.due')?.textContent
        );
        const yesterday = await isoDate(ctx, -1);
        await editViaDrawer(ctx, id, sel.drawerDue, yesterday);
        await ctx.waitFrames();
        const overdueColor = await chipColor(ctx, sel.card(id) + " .chip.due-overdue");
        const overdueText = await ctx.page.evaluate(
          () =>
            document.querySelector('.card[data-card-id="c-graph"] .card-meta .chip.due')
              ?.textContent
        );
        return ok(
          todayText === "DUE TODAY" &&
            todayColor === "rgb(20, 184, 166)" && // var(--color-due-today) resolved
            /^OVERDUE \d{2}-\d{2}$/.test(overdueText || "") &&
            overdueColor === "rgb(248, 113, 113)",
          { todayText, todayColor, overdueText, overdueColor }
        );
      },
    },
    {
      id: "b-cards-14",
      feature: "B13",
      name: "a future date is a muted DUE MM-DD, and a due card in DONE never goes red",
      run: async (ctx) => {
        await ctx.freshBoard();
        const id = KNOWN.unblockedBatchMember; // #4, col-todo
        const future = await isoDate(ctx, 5);
        await editViaDrawer(ctx, id, sel.drawerDue, future);
        await ctx.waitFrames();
        const futureRead = await ctx.page.evaluate(() => {
          const chip = document.querySelector('.card[data-card-id="c-graph"] .card-meta .chip.due');
          return { text: chip?.textContent, overdue: chip?.classList.contains("due-overdue") };
        });
        // move #4 into DONE through the drawer, then give it an overdue date
        await ctx.openDrawer(id);
        await ctx.page.click(sel.drawerMoveTo("col-done"));
        await ctx.waitFor(
          () =>
            document.querySelector('.column[data-column-id="col-done"] .card[data-card-id="c-graph"]') !==
            null
        );
        await ctx.closeDrawer();
        const yesterday = await isoDate(ctx, -1);
        await editViaDrawer(ctx, id, sel.drawerDue, yesterday);
        await ctx.waitFrames();
        const doneRead = await ctx.page.evaluate(() => {
          const chip = document.querySelector('.card[data-card-id="c-graph"] .card-meta .chip.due');
          return { text: chip?.textContent, overdue: chip?.classList.contains("due-overdue") };
        });
        const inDone = (await ctx.storedColumns())["col-done"].includes(id);
        return ok(
          futureRead.text === `DUE ${future.slice(5)}` &&
            futureRead.overdue === false &&
            inDone &&
            doneRead.text === `DUE ${yesterday.slice(5)}` &&
            doneRead.overdue === false,
          { futureRead, doneRead, inDone }
        );
      },
    },

    // --------------------------------------------------------------- B14 ----
    {
      id: "b-cards-15",
      feature: "B14",
      name: "closing the drawer flushes a pending field edit (Escape, no blur)",
      run: async (ctx) => {
        await ctx.freshBoard();
        const id = KNOWN.root;
        await ctx.openDrawer(id);
        // click into the title, select all, retype — the change event never fires
        await ctx.page.click(sel.drawerTitle);
        await ctx.press("ControlOrMeta+a");
        await ctx.page.type(sel.drawerTitle, "Flushed by escape");
        const pending = await ctx.page.evaluate(
          () => document.querySelector("#card-title").value
        );
        await ctx.press("Escape");
        await ctx.waitFor(() => document.querySelector("#card-dialog").open === false);
        const stored = (await ctx.storedCard(id)).title;
        return ok(pending === "Flushed by escape" && stored === "Flushed by escape", {
          pending,
          stored,
        });
      },
    },

    // --------------------------------------------------------------- B15 ----
    {
      id: "b-cards-16",
      feature: "B15",
      name: "Escape and backdrop close the drawer, and focus returns to the card",
      run: async (ctx) => {
        await ctx.freshBoard();
        const id = KNOWN.root;
        // Escape path
        await ctx.openDrawer(id);
        await ctx.press("Escape");
        await ctx.waitFor(() => document.querySelector("#card-dialog").open === false);
        await ctx.waitFrames();
        const escapeFocus = await ctx.page.evaluate(
          (cardId) =>
            !!document.activeElement?.closest?.(`.card[data-card-id="${cardId}"]`),
          id
        );
        // backdrop path: click beside the right-aligned drawer panel
        await ctx.openDrawer(id);
        const box = await ctx.page.locator(sel.cardDialog).boundingBox();
        await ctx.page.mouse.click(Math.max(box.x - 60, 5), box.y + box.height / 2);
        await ctx.waitFor(() => document.querySelector("#card-dialog").open === false);
        await ctx.waitFrames();
        const backdropFocus = await ctx.page.evaluate(
          (cardId) =>
            !!document.activeElement?.closest?.(`.card[data-card-id="${cardId}"]`),
          id
        );
        return ok(escapeFocus && backdropFocus, { escapeFocus, backdropFocus });
      },
    },
  ],
};
