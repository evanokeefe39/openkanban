import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach } from 'vitest';

/**
 * jsdom does not implement `<dialog>`'s modal methods.
 *
 * The app uses native `<dialog>` + `showModal()` for every overlay, and that is
 * the right choice in a browser — focus trapping, Escape handling and page
 * inertness come for free. jsdom has only `open`/`close`, so the three modal
 * methods are stubbed to keep the same contract: `showModal()` opens, `close()`
 * closes and fires the `close` event the app relies on to flush pending edits.
 *
 * This is a harness gap being filled, not app behaviour being faked: the
 * Playwright suite drives the real `<dialog>` in a real browser, and these tests
 * cover what it cannot reach cheaply.
 */
if (typeof HTMLDialogElement !== 'undefined') {
  type DialogProto = HTMLDialogElement & {
    showModal?: () => void;
    show?: () => void;
    dispatchCancelAndClose?: () => void;
  };
  const proto = HTMLDialogElement.prototype as DialogProto;
  if (!proto.showModal) {
    proto.showModal = function showModal(this: HTMLDialogElement) {
      this.open = true;
    };
    proto.show = function show(this: HTMLDialogElement) {
      this.open = true;
    };
    const nativeClose = proto.close;
    proto.close = function close(this: HTMLDialogElement, returnValue?: string) {
      if (!this.open) return;
      if (returnValue !== undefined) this.returnValue = returnValue;
      this.open = false;
      // the app's drawers flush pending edits from the `close` event
      this.dispatchEvent(new Event('close'));
    };
    /**
     * Escape, as a browser fires it: `cancel` (cancellable) then `close`.
     * jsdom wires neither, so the drawer's Escape path is driven through here
     * rather than through the keyboard. Firing both keeps the harness faithful
     * to the real event order — a component listening for `cancel` would be
     * untested otherwise.
     */
    proto.dispatchCancelAndClose = function dispatchCancelAndClose(this: HTMLDialogElement) {
      const cancel = new Event('cancel', { cancelable: true });
      this.dispatchEvent(cancel);
      if (!cancel.defaultPrevented) this.open = false;
      this.dispatchEvent(new Event('close'));
    };
    void nativeClose;
  }
}

/**
 * The component layer's shared setup.
 *
 * Two things happen around every test, and both exist to stop a test passing for
 * a reason that has nothing to do with the behaviour it names:
 *
 *  - `cleanup()` unmounts whatever was rendered. Without it a component from an
 *    earlier test stays in `document.body`, and a query for "the title input"
 *    can find a previous test's input.
 *  - the storage is wiped. The app persists through the real `localStorage`
 *    (jsdom provides one), so a test that asserts "the edit was stored" must
 *    start from a known store, not from whatever the previous test wrote.
 */
afterEach(() => {
  cleanup();
});

beforeEach(() => {
  localStorage.clear();
});
