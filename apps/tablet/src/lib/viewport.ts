/**
 * Keeps the page exactly as tall as the area the user can actually see.
 *
 * `height: 100%` trusts the WebView to resize itself when the keyboard opens, and under
 * Android's edge-to-edge it no longer does so reliably: the chat ended up floating well above
 * the keyboard (test, 22/10/2026). `visualViewport` reports what is left once the keyboard is
 * on screen, which is the only measurement that holds in every case.
 *
 * Falls back to `100%` wherever `visualViewport` is missing, so nothing changes there.
 */
export function trackViewportHeight() {
  const vv = window.visualViewport;
  if (!vv) return () => undefined;
  const apply = () => {
    document.documentElement.style.setProperty('--app-h', `${Math.round(vv.height)}px`);
    // Some Android WebViews scroll the page up instead of resizing it, which pushed the bottom
    // of the app out of sight and left a gap under the text box (test, 22/10/2026).
    window.scrollTo(0, 0);
  };
  apply();
  vv.addEventListener('resize', apply);
  vv.addEventListener('scroll', apply);
  return () => {
    vv.removeEventListener('resize', apply);
    vv.removeEventListener('scroll', apply);
  };
}
