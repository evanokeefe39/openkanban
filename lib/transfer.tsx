"use client";

import { useBoardStore } from "@/stores/board.store";
import { useViewStore } from "@/stores/view.store";
import { SCHEMA_VERSION } from "@/lib/types";
import { validateBoard } from "@/lib/board";
import { pushToast } from "@/stores/toast.store";
import type { Board } from "@/lib/types";

/**
 * Export writes a JSON download; import reads one through the confirm gate.
 * Both are the vanilla flows kept verbatim — the payload shape is the board
 * document plus `exportedAt`.
 */
export function exportBoard(): void {
  const board = useBoardStore.getState().board;
  if (!board) return;
  const payload = {
    version: SCHEMA_VERSION,
    name: board.name,
    columns: board.columns,
    cards: board.cards,
    exportedAt: new Date().toISOString(),
  };
  const text = JSON.stringify(payload, null, 2);
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `openkanban-${stamp}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  pushToast("ok", `EXPORTED ${Object.keys(board.cards).length} CARD(S) AS ${link.download}`);
}

/** Validate and confirm, then hand the accepted board to `apply`. */
export function requestImport(file: File): void {
  file
    .text()
    .then((raw) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch (error) {
        pushToast("error", `IMPORT REFUSED — NOT VALID JSON (${error instanceof Error ? error.message : String(error)})`);
        return;
      }
      const result = validateBoard(parsed);
      if (!result.ok) {
        pushToast("error", `IMPORT REFUSED — ${result.error.toUpperCase()}`);
        return;
      }
      const current = useBoardStore.getState().board;
      const body = (
        <div>
          <p>
            {`Replace the current board (${current ? Object.keys(current.cards).length : 0} card(s)) with ${Object.keys(result.board.cards).length} card(s) from "${result.board.name}"?`}
          </p>
          {result.repairs.length > 0 && (
            <>
              <p>Repairs applied to the incoming file:</p>
              <ul>
                {result.repairs.map((repair) => (
                  <li key={repair}>{repair}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      );
      useViewStore.getState().askConfirm({
        title: "IMPORT BOARD",
        body,
        okLabel: "REPLACE",
        danger: false,
        onOk: () => applyImport(result.board, result.repairs.length),
      });
    })
    .catch((error: unknown) => {
      pushToast("error", `IMPORT REFUSED — ${error instanceof Error ? error.message : String(error)}`);
    });
}

function applyImport(board: Board, repairs: number): void {
  useBoardStore.getState().setBoard(board, "import");
  const view = useViewStore.getState();
  view.setSettingsOpen(false);
  view.resetForDocumentChange();
  pushToast(
    "ok",
    `IMPORTED ${Object.keys(board.cards).length} CARD(S)${repairs ? ` — ${repairs} REPAIR(S) APPLIED` : ""}`
  );
}
