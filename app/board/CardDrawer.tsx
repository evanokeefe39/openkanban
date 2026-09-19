"use client";

import { useEffect, useRef, useState } from "react";
import { useBoardStore } from "@/stores/board.store";
import { useViewStore } from "@/stores/view.store";
import type { Board, Card } from "@/lib/types";
import {
  blockersOf,
  card as getCard,
  columnOf,
  dependentsOf,
  isDoneColumn,
  unfinishedBlockers,
} from "@/lib/graph";
import { PRIORITIES, titleCaseLabel } from "@/lib/format";
import { pushToast } from "@/stores/toast.store";
import { attemptMove } from "@/app/board/move-gate";
import { cyclePathFor } from "./cycle";

/** `CREATED 2026-09-19 14:03` — the drawer's meta line stamp. */
function stampDateTime(iso: string): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  const y = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${mo}-${d} ${hh}:${mm}`;
}

function cardNames(board: Board, ids: string[]): string[] {
  return ids.map((id) => {
    const named = getCard(board, id);
    return named ? named.title : id;
  });
}

/**
 * The card drawer. Title/notes/due are local drafts committed on blur and
 * flushed on close — Escape-closing a native dialog removes the focused input
 * before its change event can fire, so a typed edit must not be dropped.
 */
export function CardDrawer() {
  const board = useBoardStore((state) => state.board);
  const activeCardId = useViewStore((state) => state.activeCardId);
  const cardDialogOpen = useViewStore((state) => state.cardDialogOpen);
  const ref = useRef<HTMLDialogElement>(null);

  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [due, setDue] = useState("");
  const [blockerQuery, setBlockerQuery] = useState("");
  const labelInputRef = useRef<HTMLInputElement>(null);

  // fresh drafts whenever the drawer is (re)opened for a card
  useEffect(() => {
    const target = board && activeCardId ? getCard(board, activeCardId) : null;
    if (!target) return;
    setTitle(target.title);
    setNotes(target.notes);
    setDue(target.due);
    setBlockerQuery("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCardId, cardDialogOpen]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (cardDialogOpen && !dialog.open) dialog.showModal();
    else if (!cardDialogOpen && dialog.open) dialog.close();
  }, [cardDialogOpen]);

  /**
   * A blur-commit that does not eat the click which caused it.
   *
   * Clicking a PRIORITY / CLEAR / label button while a text field holds focus
   * fires the field's blur first, and committing there re-renders the drawer's
   * controls between the click's mousedown and its mouseup — so Chromium
   * composes no click at all and the user's press is silently lost. It takes two
   * clicks to apply one, with nothing reporting the failure. (Found in the
   * vanilla app and recorded in ISSUES.md; the port must not inherit it.)
   *
   * Deferring the commit by one frame lets the in-flight click finish composing
   * before the re-render replaces the node it landed on. The pending commit is
   * tracked in a ref so a close that arrives before the frame still flushes it —
   * a deferred write that silently vanishes when the drawer shuts would be a
   * worse bug than the one being fixed.
   *
   * Declared here, with the other hooks, and NOT beside the code that uses it:
   * this component returns early when no card is open, so a hook placed after
   * those returns changes the hook count between renders the moment a card is
   * clicked — and React unmounts the whole tree instead of tolerating it. That
   * regression showed up as "clicking a card makes the drawer disappear".
   */
  const pendingCommit = useRef<(() => void) | null>(null);
  useEffect(
    () => () => {
      const flush = pendingCommit.current;
      pendingCommit.current = null;
      flush?.();
    },
    []
  );

  if (!board) {
    return <dialog className="drawer" id="card-dialog" aria-labelledby="card-kicker" ref={ref} />;
  }
  const target = activeCardId ? getCard(board, activeCardId) : null;
  if (!target) {
    return <dialog className="drawer" id="card-dialog" aria-labelledby="card-kicker" ref={ref} />;
  }
  const column = columnOf(board, target.id);

  const commitCard = (mutate: (draft: Board) => void) => useBoardStore.getState().commit(mutate);

  const deferredCommit = (mutate: (draft: Board) => void) => {
    pendingCommit.current = () => commitCard(mutate);
    requestAnimationFrame(() => {
      const flush = pendingCommit.current;
      pendingCommit.current = null;
      flush?.();
    });
  };

  const patch = (fields: Partial<Card>, deferred = false) => {
    const mutate = (draft: Board) => {
      const card = draft.cards[target.id];
      if (!card) return;
      Object.assign(card, fields);
      card.updatedAt = new Date().toISOString();
    };
    if (deferred) deferredCommit(mutate);
    else commitCard(mutate);
  };

  const updateTitle = (raw: string, deferred = false) => {
    const value = raw.trim().replace(/\s+/g, " ");
    if (!value) {
      pushToast("warn", "TITLE NOT CHANGED — A CARD NEEDS A TITLE");
      setTitle(target.title);
      return;
    }
    patch({ title: value }, deferred);
  };

  const flushFields = () => {
    if (title.trim().replace(/\s+/g, " ") && title.trim().replace(/\s+/g, " ") !== target.title) {
      updateTitle(title);
    } else if (!title.trim()) {
      setTitle(target.title);
    }
    if (notes !== target.notes) patch({ notes });
    if (due !== target.due) patch({ due });
  };

  const addLabel = () => {
    const value = titleCaseLabel(labelInputRef.current?.value.trim() ?? "");
    if (!value) {
      pushToast("warn", "NO LABEL ADDED — TYPE A NAME FIRST");
      return;
    }
    if (target.labels.includes(value)) {
      pushToast("warn", `LABEL "${value}" IS ALREADY ON THIS CARD`);
      if (labelInputRef.current) labelInputRef.current.value = "";
      return;
    }
    if (labelInputRef.current) labelInputRef.current.value = "";
    patch({ labels: [...target.labels, value] });
  };

  const addBlocker = (blockerId: string) => {
    const blocker = getCard(board, blockerId);
    if (!blocker) {
      pushToast("error", "LINK REFUSED — UNKNOWN CARD");
      return;
    }
    if (target.blockedBy.includes(blockerId)) {
      pushToast("warn", "LINK ALREADY EXISTS");
      return;
    }
    const cycle = cyclePathFor(board, target.id, blockerId);
    if (cycle) {
      pushToast("error", `LINK REFUSED — WOULD CREATE A CYCLE: ${cardNames(board, cycle).join(" → ")}`);
      return;
    }
    patch({ blockedBy: [...target.blockedBy, blockerId] });
    pushToast("ok", `LINKED — "${blocker.title}" NOW BLOCKS "${target.title}"`);
  };

  const deleteCard = () => {
    const dependents = dependentsOf(board, target.id);
    const blockers = blockersOf(board, target.id);
    const body = (
      <div>
        <p>{`Delete "${target.title}"?`}</p>
        {blockers.length + dependents.length > 0 && (
          <ul>
            {blockers.map((blocker) => (
              <li key={blocker.id}>{`unblocks this card: ${blocker.title}`}</li>
            ))}
            {dependents.map((dependent) => (
              <li key={dependent.id}>{`waits on this card: ${dependent.title}`}</li>
            ))}
          </ul>
        )}
      </div>
    );
    useViewStore.getState().askConfirm({
      title: "DELETE CARD",
      body,
      okLabel: "DELETE",
      danger: true,
      onOk: () => {
        commitCard((draft) => {
          delete draft.cards[target.id];
          for (const col of draft.columns) {
            col.cardIds = col.cardIds.filter((id) => id !== target.id);
          }
          for (const other of Object.values(draft.cards)) {
            other.blockedBy = other.blockedBy.filter((id) => id !== target.id);
          }
        });
        useViewStore.getState().closeCard();
        pushToast("info", `CARD DELETED — REMOVED ${dependents.length} DEPENDENT LINK(S)`);
      },
    });
  };

  // the picker: candidates in column order, filtered by the query, cycles disabled
  const query = blockerQuery.trim().toLowerCase();
  const candidates = board.columns.flatMap((col) =>
    col.cardIds
      .map((id) => getCard(board, id))
      .filter(
        (candidate): candidate is Card =>
          !!candidate &&
          candidate.id !== target.id &&
          !target.blockedBy.includes(candidate.id) &&
          (!query || candidate.title.toLowerCase().includes(query))
      )
      .map((candidate) => ({ candidate, column: col }))
  );
  const shownCandidates = candidates.slice(0, 8);

  const blockers = blockersOf(board, target.id);
  const unfinished = unfinishedBlockers(board, target.id);
  const dependents = dependentsOf(board, target.id);

  const usedLabels = new Set<string>();
  for (const candidate of Object.values(board.cards)) {
    for (const label of candidate.labels) usedLabels.add(label);
  }

  return (
    <dialog
      className="drawer"
      id="card-dialog"
      aria-labelledby="card-kicker"
      ref={ref}
      onClose={() => {
        flushFields();
        useViewStore.getState().closeCard();
      }}
      onClick={(event) => {
        // backdrop click: the point is outside the dialog's own box
        const dialog = ref.current;
        if (!dialog) return;
        const box = dialog.getBoundingClientRect();
        const inside =
          event.clientX >= box.left &&
          event.clientX <= box.right &&
          event.clientY >= box.top &&
          event.clientY <= box.bottom;
        if (!inside) dialog.close();
      }}
    >
      <div className="drawer-head">
        <span className="drawer-kicker" id="card-kicker">
          {`CARD #${target.number} / ${column ? column.name : "UNPLACED"}`}
        </span>
        <button
          className="btn"
          id="card-close"
          type="button"
          aria-label="Close card"
          onClick={() => ref.current?.close()}
        >
          CLOSE
        </button>
      </div>
      <div className="drawer-body">
        <label className="field">
          <span className="field-label">TITLE</span>
          <input
            className="input"
            id="card-title"
            type="text"
            spellCheck={false}
            value={title}
            onChange={(event) => setTitle(event.currentTarget.value)}
            /* deferred: a click landing on a drawer control fires this blur first, and committing
               here would rebuild that control before its mouseup (ISSUES.md) */
            onBlur={(event) => updateTitle(event.currentTarget.value, true)}
          />
        </label>
        <label className="field">
          <span className="field-label">NOTES</span>
          <textarea
            className="input"
            id="card-notes"
            rows={5}
            spellCheck={false}
            value={notes}
            onChange={(event) => setNotes(event.currentTarget.value)}
            /* deferred for the same reason as the title above */
            onBlur={(event) => patch({ notes: event.currentTarget.value }, true)}
          />
        </label>
        <div className="field">
          <span className="field-label">PRIORITY</span>
          <div className="seg" id="card-priority" role="group" aria-label="Priority">
            {PRIORITIES.map((option) => (
              <button
                key={option.value}
                type="button"
                title={option.title}
                aria-pressed={target.priority === option.value ? "true" : "false"}
                data-priority={String(option.value)}
                onClick={() => patch({ priority: option.value })}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <span className="field-label">DUE</span>
          <div className="row">
            <input
              className="input"
              id="card-due"
              type="date"
              value={due}
              onChange={(event) => {
                setDue(event.currentTarget.value);
                patch({ due: event.currentTarget.value });
              }}
            />
            <button
              className="btn"
              id="card-due-clear"
              type="button"
              onClick={() => {
                setDue("");
                patch({ due: "" });
              }}
            >
              CLEAR
            </button>
          </div>
        </div>
        <div className="field">
          <span className="field-label">LABELS</span>
          <div className="chips" id="card-labels">
            {target.labels.length === 0 && <span className="hint">NO LABELS</span>}
            {target.labels.map((label) => (
              <button
                key={label}
                className="chip"
                type="button"
                data-remove-label={label}
                title={`Remove label ${label}`}
                onClick={() => patch({ labels: target.labels.filter((l) => l !== label) })}
              >
                {`${label} ×`}
              </button>
            ))}
          </div>
          <div className="row">
            <input
              className="input"
              id="card-label-input"
              list="label-options"
              placeholder="ADD LABEL"
              autoComplete="off"
              spellCheck={false}
              ref={labelInputRef}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  addLabel();
                }
              }}
            />
            <datalist id="label-options">
              {[...usedLabels].sort().map((label) => (
                <option key={label} value={label} />
              ))}
            </datalist>
            <button className="btn" id="card-label-add" type="button" onClick={addLabel}>
              ADD
            </button>
          </div>
        </div>
        <div className="field">
          <span className="field-label" id="card-blockers-label">
            {blockers.length
              ? `BLOCKED BY — ${unfinished.length} OF ${blockers.length} UNFINISHED`
              : "BLOCKED BY"}
          </span>
          <div className="chips" id="card-blockers">
            {blockers.length === 0 && <span className="hint">NOTHING BLOCKS THIS CARD</span>}
            {blockers.map((blocker) => {
              const blockerColumn = columnOf(board, blocker.id);
              const done = isDoneColumn(blockerColumn);
              return (
                <button
                  key={blocker.id}
                  className="chip"
                  type="button"
                  data-remove-blocker={blocker.id}
                  style={done ? undefined : { color: "var(--color-accent)" }}
                  title={done ? "Completed blocker — remove the link" : "Unfinished blocker — remove the link"}
                  onClick={() =>
                    patch({ blockedBy: target.blockedBy.filter((id) => id !== blocker.id) })
                  }
                >
                  {`#${blocker.number} ${blocker.title} — ${
                    done ? "DONE" : blockerColumn ? blockerColumn.name : "UNPLACED"
                  } ×`}
                </button>
              );
            })}
          </div>
          <input
            className="input"
            id="card-blocker-input"
            placeholder="ADD BLOCKER — TYPE TO FILTER"
            autoComplete="off"
            spellCheck={false}
            value={blockerQuery}
            onChange={(event) => setBlockerQuery(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              const candidate = shownCandidates[0];
              if (!candidate) {
                pushToast("warn", "NO ADDABLE CARD MATCHES THAT FILTER");
                return;
              }
              setBlockerQuery("");
              addBlocker(candidate.candidate.id);
            }}
          />
          <div className="picker" id="card-blocker-picker">
            {candidates.length === 0 ? (
              <p className="picker-note">{query ? "NO MATCHING CARD" : "NO OTHER CARDS AVAILABLE"}</p>
            ) : (
              <>
                {shownCandidates.map(({ candidate, column: candidateColumn }) => {
                  const cycle = cyclePathFor(board, target.id, candidate.id);
                  return (
                    <button
                      key={candidate.id}
                      type="button"
                      data-blocker-id={candidate.id}
                      disabled={!!cycle}
                      title={
                        cycle
                          ? `Would create a cycle: ${cardNames(board, cycle).join(" → ")}`
                          : `Make "${candidate.title}" block this card`
                      }
                      onClick={() => {
                        setBlockerQuery("");
                        addBlocker(candidate.id);
                      }}
                    >
                      <span>{candidate.title}</span>
                      <span className="picker-col">{` — ${candidateColumn.name}`}</span>
                      {cycle && <span className="picker-col"> · CYCLE</span>}
                    </button>
                  );
                })}
                {candidates.length > shownCandidates.length && (
                  <p className="picker-note">{`+${candidates.length - shownCandidates.length} MORE — REFINE THE FILTER`}</p>
                )}
              </>
            )}
          </div>
        </div>
        <div className="field">
          <span className="field-label">BLOCKS</span>
          <div className="chips" id="card-blocks">
            {dependents.length === 0 && <span className="hint">NO OTHER CARD WAITS ON THIS</span>}
            {dependents.map((dependent) => {
              const dependentColumn = columnOf(board, dependent.id);
              return (
                <span key={dependent.id} className="chip">
                  {`#${dependent.number} ${dependent.title} — ${
                    dependentColumn ? dependentColumn.name : "UNPLACED"
                  }`}
                </span>
              );
            })}
          </div>
        </div>
        <div className="field">
          <span className="field-label">MOVE TO</span>
          <div className="seg" id="card-move" role="group" aria-label="Move to column">
            {board.columns.map((columnOption) => {
              const current = column && columnOption.id === column.id;
              return (
                <button
                  key={columnOption.id}
                  type="button"
                  data-move-to={columnOption.id}
                  disabled={!!current}
                  title={current ? "Current column" : undefined}
                  onClick={() => attemptMove(target.id, columnOption.id)}
                >
                  {columnOption.name}
                </button>
              );
            })}
          </div>
        </div>
        <p className="meta-line" id="card-meta">
          {`CREATED ${stampDateTime(target.createdAt)} · UPDATED ${stampDateTime(target.updatedAt)}`}
        </p>
      </div>
      <div className="drawer-foot">
        <button className="btn danger" id="card-delete" type="button" onClick={deleteCard}>
          {blockers.length + dependents.length
            ? `DELETE CARD (${blockers.length + dependents.length} LINK(S) INVOLVED)`
            : "DELETE CARD"}
        </button>
      </div>
    </dialog>
  );
}
