"use client";

import { useEffect, useRef, useState } from "react";
import { useBoardStore } from "@/stores/board.store";
import { useViewStore } from "@/stores/view.store";
import { formatCounters } from "@/lib/format";
import type { FilterState } from "@/lib/format";
import { commitBoardName } from "@/lib/board-name";
import { ChevIcon, FilterIcon, GridIcon, SlidersIcon, TrashIcon } from "@/components/chrome/icons";

/**
 * The board title, editable in place: click it (or focus it and press Enter or
 * Space) and it becomes a field; Enter or a blur commits, Escape cancels.
 *
 * The editor and the settings drawer both commit through `commitBoardName`, so
 * the trim, the blank refusal and the title-casing are one definition.
 *
 * Escape is the subtle part. Cancelling must not then be committed by the blur
 * that Escape causes as the field is removed, so the cancel is recorded in a
 * ref and the blur handler consumes it — a state flag would not be set in time,
 * since blur fires before a re-render.
 */
function BoardTitle({ name }: { name: string }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const cancelled = useRef(false);

  useEffect(() => {
    if (editing) setDraft(name);
  }, [editing, name]);

  const open = () => {
    cancelled.current = false;
    setDraft(name);
    setEditing(true);
  };

  const commit = () => {
    setEditing(false);
    commitBoardName(draft);
  };

  if (!editing) {
    return (
      <h1
        className="board-name"
        id="board-name"
        role="button"
        tabIndex={0}
        title="Click to rename this board"
        onClick={open}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            open();
          }
        }}
      >
        {name}
      </h1>
    );
  }

  return (
    <input
      className="input board-name board-name-edit"
      id="board-name-input"
      type="text"
      aria-label="Board name"
      spellCheck={false}
      autoFocus
      value={draft}
      onChange={(event) => setDraft(event.currentTarget.value)}
      onFocus={(event) => event.currentTarget.select()}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          commit();
        } else if (event.key === "Escape") {
          cancelled.current = true;
          setEditing(false);
        }
      }}
      onBlur={() => {
        // Escape removed the field itself, so the blur it caused is not a commit
        if (cancelled.current) {
          cancelled.current = false;
          return;
        }
        commit();
      }}
    />
  );
}

/** The badge count: chips across the four categories, plus a non-empty query. */
function activeFilterCount(query: string, filters: FilterState): number {
  return (
    filters.labels.size +
    filters.priorities.size +
    filters.statuses.size +
    filters.due.size +
    (query.trim() ? 1 : 0)
  );
}

/**
 * The top bar: identity, the counters, the search field, the filter
 * disclosure, the storage lamp, and the two drawers. Import and export live in
 * the boards drawer with the rest of the document-level actions.
 */
export function TopBar({ onOpenReset }: { onOpenReset: () => void }) {
  const board = useBoardStore((state) => state.board);
  const lamp = useBoardStore((state) => state.lamp);
  const query = useViewStore((state) => state.filters.query);
  const filters = useViewStore((state) => state.filters);
  const filterOpen = useViewStore((state) => state.filterOpen);
  const setFilterQuery = useViewStore((state) => state.setFilterQuery);
  const setFilterOpen = useViewStore((state) => state.setFilterOpen);
  const setSettingsOpen = useViewStore((state) => state.setSettingsOpen);
  const setBoardsOpen = useViewStore((state) => state.setBoardsOpen);
  const filterCount = activeFilterCount(query, filters);

  if (!board) return <header className="topbar" />;

  const empty = Object.keys(board.cards).length === 0;
  const lampText = lamp.state === "saved" ? "SAVED" : lamp.state === "error" ? "STORAGE ERROR" : "READY";

  return (
    <header className="topbar">
      <span className="brand">OPENKANBAN</span>
      <BoardTitle name={board.name} />
      <p className="counters" id="counters">
        {formatCounters(board)}
      </p>
      <span className="spacer" />
      <label className="search">
        <span className="visually-hidden">Search cards</span>
        <input
          className="input"
          type="search"
          id="filter-query"
          placeholder="SEARCH TITLE / NOTES / LABEL"
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(event) => setFilterQuery(event.currentTarget.value)}
        />
      </label>
      <button
        className="btn filter-toggle"
        id="filter-toggle"
        type="button"
        aria-expanded={filterOpen ? "true" : "false"}
        aria-controls="filter-panel"
        aria-label={filterCount ? `Filter cards, ${filterCount} active` : "Filter cards"}
        title="Filter cards by label, priority, blocked state or due date"
        onClick={() => setFilterOpen(!filterOpen)}
      >
        <FilterIcon />
        <span className="filter-count" id="filter-count" hidden={filterCount === 0}>
          {String(filterCount)}
        </span>
        <ChevIcon />
      </button>
      <span className="spacer" />
      <span
        className="lamp"
        id="storage-lamp"
        data-state={lamp.state}
        title={lamp.detail || "storage status"}
      >
        <span className="lamp-dot" aria-hidden="true" />
        <span id="storage-lamp-text">{lampText}</span>
      </span>
      <button
        className="btn"
        id="btn-boards"
        type="button"
        title="Every board saved in this browser, each under its own key"
        onClick={() => {
          // the reference closes the settings drawer before another opens
          // (app.js:2127) — the boards drawer must not open underneath it
          setSettingsOpen(false);
          setBoardsOpen(true);
        }}
      >
        <GridIcon />
        BOARDS
      </button>
      <button
        className="btn"
        id="btn-settings"
        type="button"
        onClick={() => setSettingsOpen(true)}
      >
        <SlidersIcon />
        SETTINGS
      </button>
      <button
        className="btn danger"
        id="btn-reset"
        type="button"
        title="Delete every card on this board"
        disabled={empty}
        onClick={onOpenReset}
      >
        <TrashIcon />
        RESET
      </button>
    </header>
  );
}
