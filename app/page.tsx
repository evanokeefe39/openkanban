/**
 * Phase 0 shell — deliberately not the board.
 *
 * This page exists so the static export builds and the behaviour suite has a
 * second target to point at. Phase 3 replaces it with the board as a client
 * subtree, at which point the one rule that governs this file applies:
 *
 *   `localStorage` does not exist during the prerender. Never read it in render.
 *   Render a deterministic shell on the first pass and hydrate in an effect.
 *
 * Reading storage during render either fails the build or produces markup that
 * disagrees with the client's, which is the single most likely way this port
 * breaks. See `tasks/plans/next-react-port.md` (risk table).
 */
export default function Page() {
  return (
    <main className="plate" data-port-shell="1">
      <p>PORT IN PROGRESS — the vanilla board is still the reference implementation</p>
    </main>
  );
}
