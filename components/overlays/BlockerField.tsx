"use client";

/**
 * The drawer's BLOCKED BY field — the chips, the filter input, and the picker.
 *
 * Extracted from `CardDrawer` because it is a genuinely separate job: everything
 * else in the drawer edits one card's own fields, while this one is the only
 * place that reads the *graph* — it lists the blockers, offers candidate cards,
 * and refuses a link that would create a cycle. Keeping that logic in its own
 * component means the cycle rule and its presentation are read together.
 *
 * The component owns only the filter text. Everything it changes goes through
 * `onAddBlocker` / `onRemoveBlocker`, so the drawer stays the single place that
 * commits — there is no second path to a document change.
 */

import { useState } from "react";
import { pushToast } from "@/stores/toast.store";
import { cardNames } from "@/lib/format";
import { isDoneColumn } from "@/lib/graph";
import { cyclePathFor } from "@/lib/cycle";
import type { Board, Card, Column } from "@/lib/types";

/** How many candidates the picker shows before it asks the user to narrow. */
const MAX_SHOWN_CANDIDATES = 8;

export interface BlockerFieldProps {
  board: Board;
  card: Card;
  blockers: Card[];
  /** How many of `blockers` sit outside a done-flagged column. */
  unfinishedCount: number;
  /** The column a card sits in, or null when it is unplaced. */
  columnOf: (cardId: string) => Column | null;
  onAddBlocker: (blockerId: string) => void;
  onRemoveBlocker: (blockerId: string) => void;
}

export function BlockerField({
  board,
  card,
  blockers,
  unfinishedCount,
  columnOf,
  onAddBlocker,
  onRemoveBlocker,
}: BlockerFieldProps) {
  const [query, setQuery] = useState("");

  // the picker: candidates in column order, filtered by the query, cycles disabled
  const normalised = query.trim().toLowerCase();
  const candidates = board.columns.flatMap((column) =>
    column.cardIds
      .map((id) => board.cards[id])
      .filter(
        (candidate): candidate is Card =>
          !!candidate &&
          candidate.id !== card.id &&
          !card.blockedBy.includes(candidate.id) &&
          (!normalised || candidate.title.toLowerCase().includes(normalised))
      )
      .map((candidate) => ({ candidate, column }))
  );
  const shown = candidates.slice(0, MAX_SHOWN_CANDIDATES);

  /** Enter takes the first match, or says why it cannot. */
  const takeFirstMatch = () => {
    const first = shown[0];
    if (!first) {
      pushToast("warn", "NO ADDABLE CARD MATCHES THAT FILTER");
      return;
    }
    setQuery("");
    onAddBlocker(first.candidate.id);
  };

  return (
    <div className="field">
      <span className="field-label" id="card-blockers-label">
        {blockers.length
          ? `BLOCKED BY — ${unfinishedCount} OF ${blockers.length} UNFINISHED`
          : "BLOCKED BY"}
      </span>
      <div className="chips" id="card-blockers">
        {blockers.length === 0 && <span className="hint">NOTHING BLOCKS THIS CARD</span>}
        {blockers.map((blocker) => {
          const blockerColumn = columnOf(blocker.id);
          const done = isDoneColumn(blockerColumn);
          return (
            <button
              key={blocker.id}
              className="chip"
              type="button"
              data-remove-blocker={blocker.id}
              style={done ? undefined : { color: "var(--color-accent)" }}
              title={done ? "Completed blocker — remove the link" : "Unfinished blocker — remove the link"}
              onClick={() => onRemoveBlocker(blocker.id)}
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
        value={query}
        onChange={(event) => setQuery(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          takeFirstMatch();
        }}
      />
      <div className="picker" id="card-blocker-picker">
        {candidates.length === 0 ? (
          <p className="picker-note">
            {normalised ? "NO MATCHING CARD" : "NO OTHER CARDS AVAILABLE"}
          </p>
        ) : (
          <>
            {shown.map(({ candidate, column: candidateColumn }) => {
              const cycle = cyclePathFor(board, card.id, candidate.id);
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
                    setQuery("");
                    onAddBlocker(candidate.id);
                  }}
                >
                  <span>{candidate.title}</span>
                  <span className="picker-col">{` — ${candidateColumn.name}`}</span>
                  {cycle && <span className="picker-col"> · CYCLE</span>}
                </button>
              );
            })}
            {candidates.length > shown.length && (
              <p className="picker-note">{`+${candidates.length - shown.length} MORE — REFINE THE FILTER`}</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
