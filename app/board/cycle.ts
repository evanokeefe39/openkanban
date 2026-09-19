import type { Board } from "@/lib/types";
import { blockersOf } from "@/lib/graph";

/**
 * Cycle detection over the blockedBy graph — the vanilla `pathUp`/`cyclePathFor`
 * pair (app.js). lib/graph owns blocked/override but not the path search, so it
 * lives beside its only consumer, the blocker picker.
 */

/** Path from `fromId` up its blockedBy edges to `targetId`, or null. */
export function pathUp(board: Board, fromId: string, targetId: string): string[] | null {
  const stack: Array<[string, string[]]> = [[fromId, [fromId]]];
  const seen = new Set<string>([fromId]);
  while (stack.length) {
    const [id, path] = stack.pop()!;
    if (id === targetId) return path;
    for (const blocker of blockersOf(board, id)) {
      if (seen.has(blocker.id)) continue;
      seen.add(blocker.id);
      stack.push([blocker.id, [...path, blocker.id]]);
    }
  }
  return null;
}

/** The cycle path if adding `cardId` blocked by `blockerId` closes a loop. */
export function cyclePathFor(board: Board, cardId: string, blockerId: string): string[] | null {
  if (cardId === blockerId) return [cardId, cardId];
  const path = pathUp(board, blockerId, cardId);
  return path ? [cardId, ...path] : null;
}
