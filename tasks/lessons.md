# Lessons

Patterns learned the hard way while building; read before starting work so the same mistake is not repeated.

## dnd-kit does not give continuous drag-over (2026-09-19, drag layer)

- **Observed:** the ported `dropTargetFrom` produced correct marks at drop time but never mid-gesture — `.drag-over` appeared on a column body while hovering a card, and the insertion line never showed until the pointer crossed a column boundary.
- **Learned:** `DndContext.onDragOver` fires only when the collision set changes (entering/leaving a droppable), not on every pointer move like HTML5 `dragover`. Any midpoint-based drop resolution must be driven from a `pointermove` tracker (capture-phase on `window`), with dnd-kit events used only as lifecycle hooks (start/end/cancel).
- **Also:** dnd-kit hands no current pointer position to `onDragOver`; track `clientX/clientY` yourself. And `event.active.rect.current.translated` is a `ClientRect` — it has `left`/`top`, not `x`/`y`.

## Playwright reads after keyup race React state (2026-09-19, probe authoring)

- **Observed:** tick + drop-marker assertions failed when read after `keyboard.up("Control")`, even though the mid-gesture state was correct.
- **Learned:** releasing a modifier clears the selection synchronously (E6 contract), so any assertion about tick state must run while the modifier is still down, or the probe reads the post-clear world. Read transient DOM state before releasing, not after.

## Static-export prerender runs client components with store defaults (2026-09-19, build)

- **Observed:** `next build` prerender crashed with "Cannot read properties of null (reading 'columns')" even though the app worked in the browser.
- **Learned:** a component that renders a store value must guard the pre-boot `null` (`board ? ... : null`); a `!` assertion compiles clean and still explodes the build. tsc green is not build green — run `npm run build`.
