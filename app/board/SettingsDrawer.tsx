"use client";

import { useEffect, useRef } from "react";
import { useBoardStore } from "@/stores/board.store";
import type { BoardOrigin } from "@/stores/board.store";
import { useViewStore } from "@/stores/view.store";
import { BOARD_STORAGE_KEY, CORRUPT_STORAGE_KEY, VIEW_STORAGE_KEY } from "@/lib/types";
import type { Column, ViewOptions } from "@/lib/types";
import { titleCaseLabel } from "@/lib/format";
import { uid } from "@/lib/board";
import { loadSampleBoard } from "./StatusRow";
import { pushToast } from "@/stores/toast.store";
import { exportBoard, requestImport } from "./transfer";

/** App-level view-toggle metadata, as in the reference `app.js`. */
const VIEW_TOGGLES: Array<{ key: keyof ViewOptions; label: string; title: string }> = [
  { key: "showNumbers", label: "CARD NUMBERS", title: "The ticket number on each card, assigned once in creation order and never reused" },
  { key: "showPriority", label: "PRIORITY RAIL + TAGS", title: "The 2px rail on the card edge and the P0/P1/P2 tag" },
  { key: "showLabels", label: "LABELS ON CARDS", title: "Label chips on the card face — the labels themselves are untouched" },
  { key: "showDue", label: "DUE DATES", title: "Due, due-today and overdue chips on the card face" },
  { key: "showStatus", label: "BLOCKER BADGES", title: "Blocked, override and blocks chips — hiding them does not change gating" },
  { key: "highlightPriority", label: "CARD BACKGROUND BY PRIORITY", title: "Fill each card by its priority instead of drawing only the 2px rail" },
];

const ORIGIN_LABEL: Record<Exclude<BoardOrigin, null>, string> = {
  sample: "SAMPLE BOARD (seeded, not yet edited)",
  storage: "RESTORED FROM STORAGE",
  import: "IMPORTED FROM A FILE",
};

/**
 * The settings drawer. Column rows are uncontrolled (`defaultValue`) inputs
 * committing on change; pending text edits are flushed when the drawer closes,
 * because Escape removes the focused input before its change event can fire.
 */
export function SettingsDrawer({ onOpenReset, onOpenImport }: { onOpenReset: () => void; onOpenImport: () => void }) {
  const board = useBoardStore((state) => state.board);
  const origin = useBoardStore((state) => state.origin);
  const lamp = useBoardStore((state) => state.lamp);
  const lastWrite = useBoardStore((state) => state.lastWrite);
  const settingsOpen = useViewStore((state) => state.settingsOpen);
  const view = useViewStore((state) => state.view);
  const setView = useViewStore((state) => state.setView);
  const setSettingsOpen = useViewStore((state) => state.setSettingsOpen);
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (settingsOpen && !dialog.open) dialog.showModal();
    else if (!settingsOpen && dialog.open) dialog.close();
  }, [settingsOpen]);

  if (!board) {
    return <dialog className="drawer" id="settings-dialog" aria-labelledby="settings-kicker" ref={ref} />;
  }

  /** Commit every pending text edit: board name first, then the column names. */
  const flushSettingsFields = () => {
    const nameInput = ref.current?.querySelector<HTMLInputElement>("#settings-name");
    if (nameInput) setBoardName(nameInput.value);
    const rows = ref.current?.querySelectorAll<HTMLElement>(".col-row");
    rows?.forEach((row) => {
      const columnId = row.dataset.columnId;
      const input = row.querySelector<HTMLInputElement>('input[data-act="name"]');
      if (!columnId || !input) return;
      const value = input.value.trim();
      const column = board.columns.find((candidate) => candidate.id === columnId);
      if (!column || !value || titleCaseLabel(value) === column.name) return;
      renameColumn(columnId, input.value);
    });
  };

  const setBoardName = (rawName: string) => {
    const name = rawName.trim();
    if (!name) {
      pushToast("warn", "BOARD NAME NOT CHANGED — A NAME IS REQUIRED");
      const nameInput = ref.current?.querySelector<HTMLInputElement>("#settings-name");
      if (nameInput) nameInput.value = board.name;
      return;
    }
    if (titleCaseLabel(name) === board.name) return;
    useBoardStore.getState().commit((draft) => {
      draft.name = titleCaseLabel(name);
    });
  };

  const renameColumn = (columnId: string, rawName: string) => {
    const name = rawName.trim();
    if (!name) {
      pushToast("warn", "COLUMN NAME NOT CHANGED — A NAME IS REQUIRED");
      return;
    }
    useBoardStore.getState().commit((draft) => {
      const column = draft.columns.find((candidate) => candidate.id === columnId);
      if (column) column.name = titleCaseLabel(name);
    });
  };

  const moveColumnBy = (columnId: string, delta: number) => {
    const index = board.columns.findIndex((column) => column.id === columnId);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= board.columns.length) return;
    useBoardStore.getState().commit((draft) => {
      const [column] = draft.columns.splice(index, 1);
      if (!column) return;
      draft.columns.splice(target, 0, column);
    });
  };

  const requestDeleteColumn = (columnId: string) => {
    const column = board.columns.find((candidate) => candidate.id === columnId);
    if (!column) return;
    if (board.columns.length === 1) {
      pushToast("error", "CANNOT DELETE THE LAST COLUMN — A BOARD NEEDS AT LEAST ONE");
      return;
    }
    const index = board.columns.findIndex((candidate) => candidate.id === columnId);
    const destination = board.columns[index - 1] ?? board.columns[index + 1];
    if (!destination) return;
    const count = column.cardIds.length;
    const body = (
      <div>
        <p>{`Delete the column "${column.name}"?`}</p>
        <p>{count ? `${count} card(s) move to "${destination.name}".` : "The column is empty — nothing else changes."}</p>
      </div>
    );
    useViewStore.getState().askConfirm({
      title: "DELETE COLUMN",
      body,
      okLabel: "DELETE",
      danger: true,
      onOk: () => {
        useBoardStore.getState().commit((draft) => {
          const [removed] = draft.columns.splice(index, 1);
          const dest = draft.columns[index - 1] ?? draft.columns[index];
          if (!removed || !dest) return;
          dest.cardIds.push(...removed.cardIds);
          const doneColumn = draft.columns.find((candidate) => candidate.done);
          if (!doneColumn) {
            const last = draft.columns[draft.columns.length - 1];
            if (last) last.done = true;
          }
        });
        pushToast(
          "info",
          count
            ? `COLUMN DELETED — ${count} CARD(S) MOVED TO "${destination.name}"`
            : "COLUMN DELETED"
        );
      },
    });
  };

  const toggleColumnFlag = (columnId: string, flag: "gate" | "done", value: boolean) => {
    useBoardStore.getState().commit((draft) => {
      const column = draft.columns.find((candidate) => candidate.id === columnId);
      if (!column) return;
      column[flag] = value;
      if (flag === "done" && !value) {
        const doneColumn = draft.columns.find((candidate) => candidate.done);
        if (!doneColumn) {
          const last = draft.columns[draft.columns.length - 1];
          if (last) {
            last.done = true;
            pushToast("warn", `NO COLUMN WAS FLAGGED DONE — "${last.name}" RE-FLAGGED AUTOMATICALLY`);
          }
        }
      }
      if (flag === "done" && value) column.gate = true;
    });
  };

  const addColumn = () => {
    const id = uid("col");
    useBoardStore.getState().commit((draft) => {
      draft.columns.push({
        id,
        name: `COLUMN ${draft.columns.length + 1}`,
        gate: false,
        done: false,
        cardIds: [],
      });
    });
    requestAnimationFrame(() => {
      const input = ref.current?.querySelector<HTMLInputElement>(`.col-row[data-column-id="${id}"] .input`);
      if (input) {
        input.focus();
        input.select();
      }
    });
  };

  return (
    <dialog
      className="drawer"
      id="settings-dialog"
      aria-labelledby="settings-kicker"
      ref={ref}
      onClose={() => {
        flushSettingsFields();
        setSettingsOpen(false);
      }}
      onClick={(event) => {
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
        <span className="drawer-kicker" id="settings-kicker">
          SETTINGS
        </span>
        <button
          className="btn"
          id="settings-close"
          type="button"
          aria-label="Close settings"
          onClick={() => ref.current?.close()}
        >
          CLOSE
        </button>
      </div>
      <div className="drawer-body">
        <label className="field">
          <span className="field-label">BOARD NAME</span>
          <input
            className="input"
            id="settings-name"
            type="text"
            spellCheck={false}
            defaultValue={board.name}
            key={board.name}
            onBlur={(event) => setBoardName(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                setBoardName(event.currentTarget.value);
              }
            }}
          />
        </label>
        <div className="field field-divider">
          <span className="field-label">LIFECYCLE STATES</span>
          <div className="col-rows" id="settings-columns">
            {board.columns.map((column, index) => (
              <ColumnRow
                key={column.id}
                column={column}
                index={index}
                total={board.columns.length}
                onRename={renameColumn}
                onMove={moveColumnBy}
                onFlag={toggleColumnFlag}
                onDelete={requestDeleteColumn}
              />
            ))}
          </div>
          <button className="btn" id="settings-add-column" type="button" onClick={addColumn}>
            + ADD COLUMN
          </button>
          <p className="hint">
            GATE — a blocked card warns before entering this column. DONE — cards here count as
            complete when resolving blockers.
          </p>
        </div>
        <div className="field field-divider">
          <span className="field-label">VIEW OPTIONS</span>
          <span className="sub-label">DENSITY</span>
          <div className="seg" id="settings-density" role="group" aria-label="Card density">
            {(
              [
                { value: "compact", label: "COMPACT", title: "Densest spacing — fits the most cards per screen" },
                { value: "normal", label: "NORMAL", title: "More breathing room between cards and columns" },
              ] as const
            ).map((option) => (
              <button
                key={option.value}
                type="button"
                data-density={option.value}
                title={option.title}
                aria-pressed={view.density === option.value ? "true" : "false"}
                onClick={() => setView({ ...view, density: option.value })}
              >
                {option.label}
              </button>
            ))}
          </div>
          <div className="view-rows" id="settings-view">
            {VIEW_TOGGLES.map((toggle) => (
              <label key={toggle.key} className="check view-row" title={toggle.title}>
                <input
                  type="checkbox"
                  data-view={toggle.key}
                  checked={Boolean(view[toggle.key])}
                  onChange={(event) => setView({ ...view, [toggle.key]: event.currentTarget.checked })}
                />
                {toggle.label}
              </label>
            ))}
          </div>
          <p className="hint">
            Display only — hiding blocker badges does not disable gating, and these preferences are
            stored per browser, not with the board.
          </p>
        </div>

        <div className="field field-divider">
          <span className="field-label">STORAGE</span>
          <StorageInfo board={board} origin={origin} lampState={lamp.state} lastWrite={lastWrite} />
          <div className="row" data-field-actions>
            <button className="btn" id="settings-export" type="button" onClick={() => exportBoard()}>
              EXPORT JSON
            </button>
            <button className="btn" id="settings-import" type="button" onClick={onOpenImport}>
              IMPORT JSON
            </button>
            <button className="btn" id="settings-reset" type="button" disabled={Object.keys(board.cards).length === 0} onClick={onOpenReset}>
              RESET BOARD
            </button>
          </div>
        </div>

        <div className="field field-divider">
          <span className="field-label">SAMPLE</span>
          <div className="row" data-field-actions>
            <button
              className="btn"
              id="settings-sample"
              type="button"
              title="Replace this board with the eleven sample cards"
              onClick={() => {
                // the reference closes the settings drawer before the sample
                // path runs (app.js:2127) — the confirm dialog must not open
                // underneath an open drawer
                setSettingsOpen(false);
                loadSampleBoard();
              }}
            >
              LOAD SAMPLE BOARD
            </button>
          </div>
          <p className="hint">
            Replaces every card on this board with the eleven-card sample. Your columns, board name
            and view options are kept.
          </p>
        </div>
      </div>
    </dialog>
  );
}

function ColumnRow({
  column,
  index,
  total,
  onRename,
  onMove,
  onFlag,
  onDelete,
}: {
  column: Column;
  index: number;
  total: number;
  onRename: (columnId: string, rawName: string) => void;
  onMove: (columnId: string, delta: number) => void;
  onFlag: (columnId: string, flag: "gate" | "done", value: boolean) => void;
  onDelete: (columnId: string) => void;
}) {
  return (
    <div className="col-row" data-column-id={column.id}>
      <button
        className="btn mini"
        type="button"
        data-act="up"
        aria-label={`Move ${column.name} left`}
        disabled={index === 0}
        onClick={() => onMove(column.id, -1)}
      >
        ↑
      </button>
      <button
        className="btn mini"
        type="button"
        data-act="down"
        aria-label={`Move ${column.name} right`}
        disabled={index === total - 1}
        onClick={() => onMove(column.id, 1)}
      >
        ↓
      </button>
      <input
        className="input"
        type="text"
        data-act="name"
        aria-label={`Column ${index + 1} name`}
        spellCheck={false}
        defaultValue={column.name}
        key={column.name}
        onBlur={(event) => onRename(column.id, event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            onRename(column.id, event.currentTarget.value);
          }
        }}
      />
      <label className="check" title="A blocked card warns before entering this column">
        <input
          type="checkbox"
          data-act="gate"
          checked={column.gate}
          onChange={(event) => onFlag(column.id, "gate", event.currentTarget.checked)}
        />
        GATE
      </label>
      <label className="check" title="Cards here count as complete when resolving blockers">
        <input
          type="checkbox"
          data-act="done"
          checked={column.done}
          onChange={(event) => onFlag(column.id, "done", event.currentTarget.checked)}
        />
        DONE
      </label>
      <button
        className="btn mini danger"
        type="button"
        data-act="delete"
        aria-label={`Delete column ${column.name}`}
        onClick={() => onDelete(column.id)}
      >
        ×
      </button>
    </div>
  );
}

function StorageInfo({
  board,
  origin,
  lampState,
  lastWrite,
}: {
  board: { cards: Record<string, unknown> };
  origin: BoardOrigin;
  lampState: string;
  lastWrite: string | null;
}) {
  let bytes: number | null = null;
  try {
    const raw = window.localStorage.getItem(BOARD_STORAGE_KEY);
    bytes = raw === null ? 0 : new Blob([raw]).size;
  } catch {
    bytes = null;
  }
  const lines = [
    `BOARD  ${origin ? ORIGIN_LABEL[origin] : "EDITED IN THIS BROWSER"}`,
    `CARDS  ${Object.keys(board.cards).length}`,
    `KEY  ${BOARD_STORAGE_KEY}`,
    `VIEW  ${VIEW_STORAGE_KEY}`,
    bytes === null ? "SIZE  UNAVAILABLE" : `SIZE  ${bytes.toLocaleString()} BYTES`,
    `LAST WRITE  ${lastWrite || "—"}`,
    `STATUS  ${lampState.toUpperCase()}`,
    `RECOVERY COPY  ${CORRUPT_STORAGE_KEY}`,
  ];
  return (
    <p className="hint" id="settings-storage">
      {lines.join("\n")}
    </p>
  );
}
