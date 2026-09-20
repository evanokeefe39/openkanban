/**
 * What the target can do.
 *
 * A check declares the capability it needs; a target that lacks it reports the
 * check as `skipped`. A skip is never a pass and is never silent — it is counted
 * and printed in its own column, because "we did not run this" and "this works"
 * are different facts and the whole point of this suite is not to confuse them.
 *
 * Every capability here is a documented asymmetry between a browser-driven app
 * and what Playwright (or the static export) can reach, not a convenience. Two
 * of them are asymmetries the port deliberately creates.
 */
export const CAPABILITIES = {
  react: {
    // dnd-kit uses pointer events, which Playwright can synthesise — the concrete win
    // that made the port worth doing.
    "pointer-drag": true,
    // `output: "export"` emits absolute /_next/... asset paths, which resolve against the
    // filesystem root under file://. Accepted loss, asserted rather than forgotten.
    "file-protocol": false,
    "static-export": true,
    "board-collection": true,
    "in-place-rename": true,
  },
};

export const CAPABILITY_NOTES = {
  "pointer-drag":
    "the drag gesture itself is testable (pointer events) rather than only its model",
  "static-export": "the build emits a static bundle to out/, with no server features",
  "board-collection": "one board per browser; the app owns a board collection",
  "in-place-rename": "the navbar title edits in place",
};

/** True when `target` has `capability`. Unknown targets have nothing. */
export function supports(target, capability) {
  return CAPABILITIES[target]?.[capability] === true;
}
