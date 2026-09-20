import { titleCaseLabel } from "@/lib/format";
import { useBoardStore } from "@/stores/board.store";
import { pushToast } from "@/stores/toast.store";

/**
 * Commit a new board name, from whichever surface the user typed it into — the
 * settings drawer's field or the toolbar title.
 *
 * There is exactly one definition of this on purpose: two call sites that each
 * trim, validate, title-case and commit would be two chances for the refusal to
 * differ. `titleCaseLabel` is the single place a heading reads in caps
 * (`lib/format.ts`), so both surfaces land the same string.
 *
 * A blank name is refused rather than ignored: a board with no name is not a
 * state the rest of the app has an answer for, and the field keeps the previous
 * name so the refusal is visible. Returns whether a mutation was written, which
 * is what an inline editor needs in order to decide whether to leave edit mode.
 */
export function commitBoardName(rawName: string): boolean {
  const name = rawName.trim();
  if (!name) {
    pushToast("warn", "BOARD NAME NOT CHANGED — A NAME IS REQUIRED");
    return false;
  }
  const next = titleCaseLabel(name);
  const board = useBoardStore.getState().board;
  if (!board || next === board.name) return false;
  useBoardStore.getState().commit((draft) => {
    draft.name = next;
  });
  return true;
}
