"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useBoardStore } from "@/stores/board.store";
import { useViewStore } from "@/stores/view.store";
import { BOARD_INDEX_KEY, BOARD_KEY_PREFIX, CORRUPT_SUFFIX } from "@/lib/types";
import { boardKey, serializeBoard } from "@/lib/storage";
import { blockedChain, closure } from "@/lib/graph";
import { pushToast } from "@/stores/toast.store";
import { requestImport } from "@/lib/transfer";
import { TopBar } from "@/components/shell/TopBar";
import { StatusRow } from "@/components/shell/StatusRow";
import { FilterPanel } from "@/components/shell/FilterPanel";
import { SelectionBar } from "@/components/shell/SelectionBar";
import { Board } from "@/components/board/Board";
import { CardDrawer } from "@/components/overlays/CardDrawer";
import { SettingsDrawer } from "@/components/overlays/SettingsDrawer";
import { BoardsDrawer } from "@/components/overlays/BoardsDrawer";
import { ConfirmDialog } from "@/components/overlays/ConfirmDialog";
import { ResetDialog } from "@/components/overlays/ResetDialog";
import { ToastHost } from "@/components/shell/ToastHost";
import { DragLayer } from "@/components/board/DragLayer";

/**
 * The shell. Boots both stores once, owns the document-level listeners (the
 * hotkeys, window blur, the cross-tab storage event) and the hidden file
 * input, and composes every surface in the reference's order.
 */
export function BoardRoot() {
  const board = useBoardStore((state) => state.board);
  const [resetOpen, setResetOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // boot — storage does not exist during the prerender, so this is an effect
  useEffect(() => {
    useBoardStore.getState().boot();
    useViewStore.getState().bootView();
  }, []);

  // the boot notice was raised before the toast host could hear it
  const bootNotice = useBoardStore((state) => state.bootNotice);
  useEffect(() => {
    if (!bootNotice) return;
    pushToast(bootNotice.kind, bootNotice.text);
    useBoardStore.getState().clearBootNotice();
  }, [bootNotice]);

  // view options and document-level state land on <html>, as the reference's
  // applyView/renderHeader do — the CSS in board.css keys off these
  const view = useViewStore((state) => state.view);
  // the imperative passes below (selection ticks, select mode, deps mode) run
  // in a layout effect after every render, so these subscriptions exist only
  // to re-render this component when they change — without them the patch
  // pass never fires and data-picked never lands
  useViewStore((state) => state.selection);
  useViewStore((state) => state.selectMode);
  useViewStore((state) => state.depsHeld);
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.density = view.density;
    for (const key of ["showNumbers", "showPriority", "showLabels", "showDue", "showStatus", "highlightPriority"] as const) {
      root.dataset[key] = view[key] ? "1" : "0";
    }
  }, [view]);

  // document-level listeners, bound once
  useEffect(() => {
    const isTypingTarget = (target: EventTarget | null) =>
      target instanceof Element &&
      !!target.closest('input, textarea, select, [contenteditable="true"]');
    const dialogOpen = () => document.querySelector("dialog[open]") !== null;

    const releaseCtrl = () => {
      if (!useViewStore.getState().selectMode) return;
      useViewStore.getState().setSelectMode(false);
    };
    const releaseDeps = () => {
      if (!useViewStore.getState().depsHeld) return;
      useViewStore.getState().setDepsHeld(false);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      // Ctrl/Cmd is the bulk-selection mode; releasing it clears the selection
      if (event.key === "Control" || event.key === "Meta") {
        if (!useViewStore.getState().selectMode) useViewStore.getState().setSelectMode(true);
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (isTypingTarget(event.target) || dialogOpen()) return;
      // Escape closes the filter pane — dialogs own their own Escape
      if (event.key === "Escape") {
        if (!useViewStore.getState().filterOpen) return;
        useViewStore.getState().setFilterOpen(false);
        document.getElementById("filter-toggle")?.focus();
        return;
      }
      // holding D reveals the dependency wiring
      if (event.key === "d" || event.key === "D") {
        if (!useViewStore.getState().depsHeld) useViewStore.getState().setDepsHeld(true);
        return;
      }
      // C puts a new card at the top of the first column
      if (event.key === "c" || event.key === "C") {
        const first = useBoardStore.getState().board?.columns[0];
        if (!first) return;
        event.preventDefault();
        useViewStore.getState().openInline(first.id);
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === "Control" || event.key === "Meta") releaseCtrl();
      if (event.key === "d" || event.key === "D") releaseDeps();
    };
    // alt-tabbing mid-hold must not strand either mode
    const onBlur = () => {
      releaseCtrl();
      releaseDeps();
    };
    // cross-tab guard: never silently lose a board written elsewhere.
    // Per-board keys make the scope precise — only the board this tab actually
    // has open can make it stale, and a change to any other board (or to the
    // index) is another board's business, not a warning.
    const staleWarning = "THIS BOARD CHANGED IN ANOTHER TAB — RELOAD TO SYNC (LAST WRITE WINS)";
    const onStorage = (event: StorageEvent) => {
      if (event.key === null) {
        // storage.clear(): the open board went with it, and so did the list
        useBoardStore.getState().refreshBoards();
        pushToast("warn", staleWarning, 12000);
        return;
      }
      if (event.key === BOARD_INDEX_KEY) {
        // another tab added, removed or switched a board — the list is stale
        useBoardStore.getState().refreshBoards();
        return;
      }
      if (!event.key.startsWith(BOARD_KEY_PREFIX) || event.key.endsWith(CORRUPT_SUFFIX)) return;
      const { activeId, board: current } = useBoardStore.getState();
      if (!activeId || event.key !== boardKey(activeId)) return;
      if (event.newValue && current && event.newValue === serializeBoard(current)) return;
      pushToast("warn", staleWarning, 12000);
    };

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    window.addEventListener("storage", onStorage);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  // The dependency overlay and the selection ticks are patched onto the live
  // DOM nodes, NOT carried as React state: a re-render on hover would reset
  // each column's scroll position under the pointer and rebuild the tick out
  // from under a click. The pass runs after every render, like the reference's
  // render() ending in applyChainHighlight()/applySelection().
  const chainIdRef = useRef<string | null>(null);
  const patchRef = useRef<() => void>(() => {});

  patchRef.current = () => {
    const view = useViewStore.getState();
    const root = document.documentElement;

    // document identity: the title must read the board name the moment the
    // document exists, on the same pass that paints it
    const boardDoc = useBoardStore.getState().board;
    if (boardDoc) {
      root.dataset.boardEmpty = Object.keys(boardDoc.cards).length === 0 ? "1" : "0";
      document.title = `${boardDoc.name} — OpenKanban`;
    }

    // selection pass — a deleted card leaves the ticked set (E7). Liveness is
    // the cards map, not the columns' cardIds: the reset clears `cards` and
    // leaves `cardIds` dangling, so a column-derived set would count ghosts —
    // the reference's applySelection prunes `if (!card(id))` (app.js:1263).
    const liveIds = new Set<string>(Object.keys(useBoardStore.getState().board?.cards ?? {}));
    for (const id of [...view.selection]) {
      if (!liveIds.has(id)) {
        view.pruneSelection(liveIds);
        break;
      }
    }
    root.dataset.selectMode = view.selectMode ? "1" : "0";
    for (const node of document.querySelectorAll<HTMLDivElement>("#board .card")) {
      const id = node.dataset.cardId ?? "";
      const ticked = view.selection.has(id);
      if (ticked) node.dataset.picked = "1";
      else node.removeAttribute("data-picked");
      const tick = node.querySelector<HTMLInputElement>(".card-tick");
      if (tick) tick.checked = ticked;
    }

    // dependency pass — the hovered card is the subject and gets no cane
    const anchor = view.depsHeld ? chainIdRef.current : null;
    root.dataset.depsMode = view.depsHeld ? "1" : "0";
    const boardNow = useBoardStore.getState().board;
    const blocks = anchor && boardNow ? closure(boardNow, anchor, "down") : null;
    const blocked = anchor && boardNow ? blockedChain(boardNow, anchor) : null;
    for (const node of document.querySelectorAll<HTMLDivElement>("#board .card")) {
      const id = node.dataset.cardId ?? "";
      const isBlocks = !!blocks && blocks.has(id);
      const isBlocked = !!blocked && blocked.has(id);
      if (id === anchor) node.removeAttribute("data-chain");
      else if (isBlocks && isBlocked) node.dataset.chain = "both";
      else if (isBlocks) node.dataset.chain = "blocks";
      else if (isBlocked) node.dataset.chain = "blocked";
      else node.removeAttribute("data-chain");
    }
  };

  // after every render, exactly like the reference's render() tail
  useLayoutEffect(() => {
    patchRef.current();
  });

  // hover/focus drives the chain read-out through the ref, never state, and
  // each change patches immediately (no re-render to wait for)
  useEffect(() => {
    const patch = () => patchRef.current();
    const cardUnder = (target: EventTarget | null): string | null => {
      if (!(target instanceof Element)) return null;
      const cardEl = target.closest("#board .card");
      return cardEl ? ((cardEl as HTMLElement).dataset.cardId ?? null) : null;
    };
    const onOver = (event: MouseEvent) => {
      const id = cardUnder(event.target);
      if (id === chainIdRef.current) return;
      chainIdRef.current = id;
      patch();
    };
    const onFocusIn = (event: FocusEvent) => {
      const id = cardUnder(event.target);
      if (id === chainIdRef.current) return;
      chainIdRef.current = id;
      patch();
    };
    const onFocusOut = () => {
      if (!chainIdRef.current) return;
      chainIdRef.current = null;
      patch();
    };
    document.addEventListener("mouseover", onOver);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    // any store change that affects the ticks or the overlay re-patches
    let last = { selectMode: false, depsHeld: false, selection: new Set<string>() };
    const unsubscribe = useViewStore.subscribe((state) => {
      if (
        state.selectMode !== last.selectMode ||
        state.depsHeld !== last.depsHeld ||
        state.selection !== last.selection
      ) {
        last = { selectMode: state.selectMode, depsHeld: state.depsHeld, selection: state.selection };
        patch();
      }
    });
    return () => {
      document.removeEventListener("mouseover", onOver);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
      unsubscribe();
    };
  }, []);

  // popover dismissal: click anywhere outside, capture phase (a chip click
  // re-renders the pane and detaches the node a bubble-phase check would see)
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (!useViewStore.getState().filterOpen) return;
      if (event.target instanceof Element && event.target.closest("#filter-panel, #filter-toggle")) return;
      useViewStore.getState().setFilterOpen(false);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  return (
    <div className="app">
      <TopBar onOpenReset={() => setResetOpen(true)} />
      <StatusRow />
      <FilterPanel />
      <SelectionBar />
      <DragLayer>
        {board ? <Board board={board} /> : null}
      </DragLayer>
      <CardDrawer />
      <SettingsDrawer />
      <BoardsDrawer onOpenImport={() => fileInputRef.current?.click()} />
      <ConfirmDialog />
      <ResetDialog open={resetOpen} onOpenChange={setResetOpen} />
      <ToastHost />
      <input
        type="file"
        id="import-input"
        accept=".json,application/json"
        hidden
        ref={fileInputRef}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) requestImport(file);
        }}
      />
    </div>
  );
}
