"use client";

import { useBoardStore } from "@/stores/board.store";
import { useViewStore } from "@/stores/view.store";
import { formatCounters } from "@/lib/format";
import type { FilterState } from "@/lib/format";
import { ChevIcon, DownloadIcon, FilterIcon, SlidersIcon, TrashIcon, UploadIcon } from "./icons";
import { exportBoard } from "./transfer";

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
 * disclosure, the storage lamp and the four document actions.
 */
export function TopBar({ onOpenReset, onOpenImport }: { onOpenReset: () => void; onOpenImport: () => void }) {
  const board = useBoardStore((state) => state.board);
  const lamp = useBoardStore((state) => state.lamp);
  const query = useViewStore((state) => state.filters.query);
  const filters = useViewStore((state) => state.filters);
  const filterOpen = useViewStore((state) => state.filterOpen);
  const setFilterQuery = useViewStore((state) => state.setFilterQuery);
  const setFilterOpen = useViewStore((state) => state.setFilterOpen);
  const setSettingsOpen = useViewStore((state) => state.setSettingsOpen);
  const filterCount = activeFilterCount(query, filters);

  if (!board) return <header className="topbar" />;

  const empty = Object.keys(board.cards).length === 0;
  const lampText = lamp.state === "saved" ? "SAVED" : lamp.state === "error" ? "STORAGE ERROR" : "READY";

  return (
    <header className="topbar">
      <span className="brand">OPENKANBAN</span>
      <h1 className="board-name" id="board-name">
        {board.name}
      </h1>
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
      <button className="btn" id="btn-export" type="button" onClick={() => exportBoard()}>
        <DownloadIcon />
        EXPORT
      </button>
      <button className="btn" id="btn-import" type="button" onClick={onOpenImport}>
        <UploadIcon />
        IMPORT
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
