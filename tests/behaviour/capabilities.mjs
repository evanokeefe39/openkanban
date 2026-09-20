/**
 * What each target can do.
 *
 * A check declares the capability it needs; a target that lacks it reports the
 * check as `skipped`. A skip is never a pass and is never silent — it is counted
 * and printed in its own column, because "we did not run this" and "this works"
 * are different facts and the whole point of this suite is not to confuse them.
 *
 * Every capability here is a known, documented asymmetry between the two apps,
 * not a convenience. Two of them are asymmetries the port deliberately creates.
 */
export const CAPABILITIES = {
  vanilla: {
    // Playwright fires `dragstart` and `dragover` but can never synthesise an HTML5
    // `drop`, so the gesture itself is hand-verified for this app (ISSUES.md).
    "pointer-drag": false,
    "html5-drag": true,
    // three static files with relative paths: opens from file://
    "file-protocol": true,
    // no build output to inspect
    "static-export": false,
    // the vanilla app keeps the single-board key and is FROZEN: the collection
    // is a React-app feature, so K1-K9 defer here rather than fail. Deferred is
    // printed, never counted as covered.
    "board-collection": false,
    // the navbar title is a plain read-only h1 in the frozen reference; in-place
    // editing exists only in the React app, so those checks defer here.
    "in-place-rename": false,
  },
  react: {
    // dnd-kit uses pointer events, which Playwright can synthesise — the concrete win
    // that made the port worth doing.
    "pointer-drag": true,
    "html5-drag": false,
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
  "html5-drag": "the HTML5 drag the vanilla app uses cannot be driven from a synthetic mouse",
  "file-protocol": "the app opens directly from the filesystem, with no server",
  "static-export": "the build emits a static bundle to out/, with no server features",
  "board-collection":
    "one board per browser; the vanilla reference is frozen on the single-board key",
  "in-place-rename":
    "the navbar title edits in place; the vanilla reference's title is read-only and frozen",
};

/** True when `target` has `capability`. Unknown targets have nothing. */
export function supports(target, capability) {
  return CAPABILITIES[target]?.[capability] === true;
}
