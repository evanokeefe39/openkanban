"use client";

import { useEffect, useRef } from "react";
import { useBoardStore } from "@/stores/board.store";
import { useViewStore } from "@/stores/view.store";
import { PRIORITIES } from "@/lib/format";
import type { FilterState } from "@/lib/format";

/** The filter categories behind the strip chevron — app-level constants, as in
 *  the reference `app.js` (lib/format owns only the matching logic). */
const STATUS_FILTERS = [
  { id: "blocked", label: "BLOCKED", title: "Cards with at least one unfinished blocker" },
  { id: "override", label: "OVERRIDE", title: "Blocked cards sitting in a gated column" },
  { id: "blocking", label: "BLOCKING", title: "Cards that other cards wait on" },
] as const;

const DUE_FILTERS = [
  { id: "overdue", label: "OVERDUE", title: "Past due and not in a done column" },
  { id: "today", label: "DUE TODAY", title: "Due today and not in a done column" },
] as const;

/**
 * The filter popover. Fixed-positioned from the trigger's rect and clamped to
 * the viewport, since the bar scrolls horizontally.
 */
export function FilterPanel() {
  const board = useBoardStore((state) => state.board);
  const filters = useViewStore((state) => state.filters);
  const filterOpen = useViewStore((state) => state.filterOpen);
  const toggleFilterKey = useViewStore((state) => state.toggleFilterKey);
  const clearFilters = useViewStore((state) => state.clearFilters);
  const ref = useRef<HTMLDivElement>(null);

  // rendered before measuring: the pane's own width depends on its content
  useEffect(() => {
    if (!filterOpen) return;
    const panel = ref.current;
    const trigger = document.getElementById("filter-toggle");
    if (!panel || !trigger) return;
    const position = () => {
      const rect = trigger.getBoundingClientRect();
      const margin = 12;
      const left = Math.max(margin, Math.min(rect.left, window.innerWidth - panel.offsetWidth - margin));
      panel.style.left = `${Math.round(left)}px`;
      panel.style.top = `${Math.round(rect.bottom + 6)}px`;
    };
    position();
    window.addEventListener("resize", position);
    return () => window.removeEventListener("resize", position);
  }, [filterOpen]);

  // The panel keeps its content in the DOM and is only hidden when closed, which is what the
  // reference does (`app.js:994`: `$('filter-panel').hidden = !ui.filterOpen`). Emptying the
  // element instead would unmount the chips, and a check that counts them while the pane is
  // shut would read zero — a filter that is still applied would look like it had vanished.
  const used = new Set<string>();
  for (const target of Object.values(board?.cards ?? {})) {
    for (const label of target.labels) used.add(label);
  }

  const count = activeCount(filters);

  return (
    <div className="filter-panel" id="filter-panel" hidden={!filterOpen} ref={ref}>
      <FilterGroup name="LABEL">
        {used.size === 0 ? (
          <span className="hint">NO LABELS ON THIS BOARD YET</span>
        ) : (
          [...used].sort().map((label) => (
            <FilterChip
              key={label}
              chipKey={`label:${label}`}
              label={label}
              pressed={filters.labels.has(label)}
              title={`Show only cards labelled ${label}`}
              onToggle={toggleFilterKey}
            />
          ))
        )}
      </FilterGroup>
      <FilterGroup name="PRIORITY">
        {PRIORITIES.map((option) => (
          <FilterChip
            key={option.value}
            chipKey={`prio:${option.value}`}
            label={option.value === 0 ? "NONE" : option.label}
            pressed={filters.priorities.has(option.value)}
            title={option.title}
            swatchPrio={option.value}
            onToggle={toggleFilterKey}
          />
        ))}
      </FilterGroup>
      <FilterGroup name="BLOCKED">
        {STATUS_FILTERS.map((option) => (
          <FilterChip
            key={option.id}
            chipKey={`status:${option.id}`}
            label={option.label}
            pressed={filters.statuses.has(option.id)}
            title={option.title}
            onToggle={toggleFilterKey}
          />
        ))}
      </FilterGroup>
      <FilterGroup name="DUE">
        {DUE_FILTERS.map((option) => (
          <FilterChip
            key={option.id}
            chipKey={`due:${option.id}`}
            label={option.label}
            pressed={filters.due.has(option.id)}
            title={option.title}
            onToggle={toggleFilterKey}
          />
        ))}
      </FilterGroup>
      <div className="filter-panel-foot">
        <button
          className="btn"
          type="button"
          data-act="clear"
          disabled={count === 0}
          onClick={() => clearFilters()}
        >
          CLEAR ALL
        </button>
      </div>
    </div>
  );
}

function FilterGroup({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <div className="filter-group">
      <span className="filter-group-name">{name}</span>
      <div className="chips">{children}</div>
    </div>
  );
}

function FilterChip({
  chipKey,
  label,
  pressed,
  title,
  swatchPrio,
  onToggle,
}: {
  chipKey: string;
  label: string;
  pressed: boolean;
  title: string;
  swatchPrio?: number;
  onToggle: (key: string) => void;
}) {
  return (
    <button
      className="chip"
      type="button"
      data-filter-key={chipKey}
      data-prio={swatchPrio !== undefined ? String(swatchPrio) : undefined}
      aria-pressed={pressed ? "true" : "false"}
      title={title}
      onClick={() => onToggle(chipKey)}
    >
      {swatchPrio !== undefined && <i className="prio-swatch" />}
      {label}
    </button>
  );
}

/** Duplicated badge count so the pane's CLEAR ALL arms without TopBar. */
function activeCount(filters: FilterState): number {
  return (
    filters.labels.size + filters.priorities.size + filters.statuses.size + filters.due.size
  );
}
